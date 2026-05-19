#!/usr/bin/env node
import "dotenv/config";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pg;

const sourceDbUrl = process.env.SOURCE_DATABASE_URL || process.argv[2];
const targetDbUrl = process.env.TARGET_DATABASE_URL || process.argv[3];
const sourceSupabaseUrl = process.env.SOURCE_SUPABASE_URL || "";
const sourceSupabaseServiceRoleKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || "";
const targetSupabaseUrl = process.env.TARGET_SUPABASE_URL || "";
const targetSupabaseServiceRoleKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY || "";
const sourceBucket = process.env.SOURCE_BUCKET || process.env.SOURCE_SUPABASE_STORAGE_BUCKET || "";
const targetBucket = process.env.TARGET_BUCKET || process.env.TARGET_SUPABASE_STORAGE_BUCKET || "";

if (!sourceDbUrl || !targetDbUrl) {
  console.error("Missing DB URLs.");
  console.error("Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL (or pass as args).");
  process.exit(1);
}

const ssl = { rejectUnauthorized: false };
const sourceDb = new Pool({ connectionString: sourceDbUrl, ssl });
const targetDb = new Pool({ connectionString: targetDbUrl, ssl });

async function getPublicTables(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `);
  return rows.map((r) => String(r.table_name));
}

async function getTableCount(client, tableName) {
  const sql = `SELECT COUNT(*)::bigint AS count FROM "public"."${String(tableName).replace(/"/g, "\"\"")}"`;
  const { rows } = await client.query(sql);
  return Number(rows?.[0]?.count ?? 0);
}

async function getDbCounts() {
  const sourceTables = await getPublicTables(sourceDb);
  const targetTables = await getPublicTables(targetDb);
  const allTables = Array.from(new Set([...sourceTables, ...targetTables])).sort((a, b) => a.localeCompare(b));

  const rows = [];
  for (const table of allTables) {
    const sourceHas = sourceTables.includes(table);
    const targetHas = targetTables.includes(table);
    const sourceCount = sourceHas ? await getTableCount(sourceDb, table) : null;
    const targetCount = targetHas ? await getTableCount(targetDb, table) : null;
    const match = sourceCount === targetCount;
    rows.push({ table, sourceCount, targetCount, match, sourceHas, targetHas });
  }
  return rows;
}

async function countStorageObjects(supabaseUrl, serviceRoleKey, bucket) {
  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    return { bucket, count: null, skipped: true, reason: "missing_url_or_key_or_bucket" };
  }

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let from = 0;
  const pageSize = 1000;
  let total = 0;

  while (true) {
    const { data, error } = await client.storage.from(bucket).list("", {
      limit: pageSize,
      offset: from,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      return { bucket, count: null, skipped: false, error: error.message };
    }
    const items = data || [];
    total += items.length;
    if (items.length < pageSize) break;
    from += pageSize;
  }

  return { bucket, count: total, skipped: false };
}

async function run() {
  try {
    console.log("Verifying DB table counts (source vs target)...");
    const dbRows = await getDbCounts();

    const mismatches = dbRows.filter((r) => !r.match);
    for (const row of dbRows) {
      const sourceText = row.sourceHas ? String(row.sourceCount) : "N/A";
      const targetText = row.targetHas ? String(row.targetCount) : "N/A";
      const status = row.match ? "OK" : "MISMATCH";
      console.log(`${status.padEnd(9)} ${row.table.padEnd(30)} source=${sourceText.padStart(8)} target=${targetText.padStart(8)}`);
    }

    console.log("\nVerifying storage object counts...");
    const sourceStorage = await countStorageObjects(
      sourceSupabaseUrl,
      sourceSupabaseServiceRoleKey,
      sourceBucket,
    );
    const targetStorage = await countStorageObjects(
      targetSupabaseUrl,
      targetSupabaseServiceRoleKey,
      targetBucket,
    );

    if (sourceStorage.skipped || targetStorage.skipped) {
      console.log(
        `Storage check skipped. sourceBucket=${sourceBucket || "<missing>"} targetBucket=${targetBucket || "<missing>"}`,
      );
    } else if (sourceStorage.error || targetStorage.error) {
      console.log("Storage check failed:");
      if (sourceStorage.error) console.log(`- source: ${sourceStorage.error}`);
      if (targetStorage.error) console.log(`- target: ${targetStorage.error}`);
    } else {
      const sourceCount = Number(sourceStorage.count ?? 0);
      const targetCount = Number(targetStorage.count ?? 0);
      const storageMatch = sourceCount === targetCount;
      console.log(
        `${storageMatch ? "OK" : "MISMATCH"} storage bucket counts: source=${sourceCount} target=${targetCount}`,
      );
    }

    console.log("\nSummary:");
    console.log(`- DB tables compared: ${dbRows.length}`);
    console.log(`- DB mismatches: ${mismatches.length}`);
    if (mismatches.length > 0) {
      console.log("- Mismatch tables:");
      for (const row of mismatches) {
        console.log(`  - ${row.table}: source=${row.sourceCount ?? "N/A"}, target=${row.targetCount ?? "N/A"}`);
      }
      process.exitCode = 2;
    } else {
      console.log("- DB counts look good.");
    }
  } catch (error) {
    console.error("verify:copy failed:", error?.message || String(error));
    process.exitCode = 1;
  } finally {
    await sourceDb.end();
    await targetDb.end();
  }
}

run();

