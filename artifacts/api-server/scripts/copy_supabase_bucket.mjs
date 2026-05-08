#!/usr/bin/env node
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sourceUrl = process.env.SOURCE_SUPABASE_URL || process.argv[2];
const sourceKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || process.argv[3];
const targetUrl = process.env.TARGET_SUPABASE_URL || process.argv[4];
const targetKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY || process.argv[5];

const sourceBucket = process.env.SOURCE_BUCKET || "prepmap-files";
const targetBucket = process.env.TARGET_BUCKET || sourceBucket;
const rootPrefix = (process.env.STORAGE_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
const pageSize = Number(process.env.STORAGE_PAGE_SIZE || 1000);

if (!sourceUrl || !sourceKey || !targetUrl || !targetKey) {
  console.error("Usage:");
  console.error("  SOURCE_SUPABASE_URL=... SOURCE_SUPABASE_SERVICE_ROLE_KEY=... TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/copy_supabase_bucket.mjs");
  console.error("or");
  console.error("  node scripts/copy_supabase_bucket.mjs <source_url> <source_service_role_key> <target_url> <target_service_role_key>");
  process.exit(1);
}

const source = createClient(sourceUrl, sourceKey, { auth: { persistSession: false } });
const target = createClient(targetUrl, targetKey, { auth: { persistSession: false } });

function joinPath(parent, child) {
  if (!parent) return child;
  return `${parent}/${child}`;
}

async function ensureTargetBucket() {
  const { data, error } = await target.storage.listBuckets();
  if (error) throw error;
  const exists = data.some((b) => b.name === targetBucket);
  if (exists) return;

  const { error: createError } = await target.storage.createBucket(targetBucket, {
    public: false,
  });
  if (createError) throw createError;
  console.log(`Created target bucket: ${targetBucket}`);
}

async function listAllFiles(bucket, prefix) {
  const files = [];
  const queue = [prefix];

  while (queue.length > 0) {
    const current = queue.shift();
    let offset = 0;

    while (true) {
      const { data, error } = await source.storage.from(bucket).list(current, {
        limit: pageSize,
        offset,
      });
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const item of data) {
        const fullPath = joinPath(current, item.name);
        const isFolder = item.id === null;
        if (isFolder) {
          queue.push(fullPath);
        } else {
          files.push({
            path: fullPath,
            contentType: item.metadata?.mimetype || "application/octet-stream",
          });
        }
      }

      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  return files;
}

async function copyFile(file) {
  const { data: sourceBlob, error: downloadError } = await source.storage.from(sourceBucket).download(file.path);
  if (downloadError) {
    const msg = String(downloadError?.message || "").toLowerCase();
    if (msg.includes("not found") || msg.includes("resource was not found")) {
      return { skipped: true, reason: "not_found" };
    }
    throw downloadError;
  }

  const bytes = new Uint8Array(await sourceBlob.arrayBuffer());

  const { error: uploadError } = await target.storage.from(targetBucket).upload(file.path, bytes, {
    upsert: true,
    contentType: file.contentType,
  });
  if (uploadError) throw uploadError;
  return { skipped: false };
}

async function run() {
  const startedAt = Date.now();
  try {
    await ensureTargetBucket();
    const files = await listAllFiles(sourceBucket, rootPrefix);
    console.log(`Found ${files.length} files under ${sourceBucket}/${rootPrefix}`);

    let copied = 0;
    let skippedNotFound = 0;
    for (const file of files) {
      const result = await copyFile(file);
      if (result?.skipped) {
        skippedNotFound += 1;
        console.warn(`Skipped missing source object: ${file.path}`);
      } else {
        copied += 1;
      }
      const processed = copied + skippedNotFound;
      if (processed % 25 === 0 || processed === files.length) {
        console.log(`Processed ${processed}/${files.length} (copied: ${copied}, skipped_missing: ${skippedNotFound})`);
      }
    }

    console.log("\nStorage copy complete.");
    console.log(`Files copied: ${copied}`);
    console.log(`Files skipped (missing at source): ${skippedNotFound}`);
    console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  } catch (error) {
    if (error && typeof error === "object") {
      const anyErr = error;
      console.error("Storage copy failed:", {
        message: anyErr.message,
        code: anyErr.code,
        details: anyErr.details,
        hint: anyErr.hint,
      });
    } else {
      console.error("Storage copy failed:", String(error));
    }
    process.exitCode = 1;
  }
}

run();
