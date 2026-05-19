#!/usr/bin/env node
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const sourceUrl = process.env.SOURCE_DATABASE_URL || process.argv[2];
const targetUrl = process.env.TARGET_DATABASE_URL || process.argv[3];
const truncateTarget = String(process.env.COPY_TRUNCATE_TARGET || "false").toLowerCase() === "true";
const batchSize = Number(process.env.COPY_BATCH_SIZE || 500);

if (!sourceUrl || !targetUrl) {
  console.error("Usage:");
  console.error("  SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/copy_db_to_db.mjs");
  console.error("or");
  console.error("  node scripts/copy_db_to_db.mjs <source_database_url> <target_database_url>");
  process.exit(1);
}

const ssl = { rejectUnauthorized: false };
const source = new Pool({ connectionString: sourceUrl, ssl });
const target = new Pool({ connectionString: targetUrl, ssl });

const quote = (id) => `"${String(id).replace(/"/g, "\"\"")}"`;

const preferredOrder = [
  "universities",
  "subjects",
  "users",
  "configs",
  "unit_library",
  "config_unit_links",
  "nodes",
  "subtopic_contents",
  "subtopic_questions",
  "events",
  "subject_reading_materials",
];

const jsonTypes = new Set(["json", "jsonb"]);

function normalizeValue(value, udtName, dataType) {
  if (value === null || value === undefined) return null;
  if (jsonTypes.has(dataType) && typeof value !== "string") return JSON.stringify(value);
  // Keep arrays as-is for postgres array columns (e.g. text[])
  if (udtName?.startsWith("_") && Array.isArray(value)) return value;
  return value;
}

function buildInsertSql(tableName, columns, rowCount) {
  const colSql = columns.map((c) => quote(c)).join(", ");
  const valuesSql = Array.from({ length: rowCount }, (_, rowIdx) => {
    const placeholders = columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
    return `(${placeholders.join(", ")})`;
  }).join(", ");
  return `INSERT INTO ${quote("public")}.${quote(tableName)} (${colSql}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
}

async function getPublicTables(client) {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `);
  const tableNames = rows.map((r) => String(r.table_name));
  const ordered = [
    ...preferredOrder.filter((t) => tableNames.includes(t)),
    ...tableNames.filter((t) => !preferredOrder.includes(t)),
  ];
  return ordered;
}

async function getColumnsMeta(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT
      column_name,
      data_type,
      udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position ASC
    `,
    [tableName],
  );
  return rows.map((r) => ({
    columnName: String(r.column_name),
    dataType: String(r.data_type),
    udtName: String(r.udt_name),
  }));
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = $1
      AND table_type = 'BASE TABLE'
    LIMIT 1
    `,
    [tableName],
  );
  return rows.length > 0;
}

async function getTableColumnDefs(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS column_default
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum ASC
    `,
    [tableName],
  );
  return rows.map((r) => ({
    columnName: String(r.column_name),
    formattedType: String(r.formatted_type),
    notNull: Boolean(r.not_null),
    columnDefault: r.column_default === null ? null : String(r.column_default),
  }));
}

async function getPrimaryKeyColumns(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND i.indisprimary
    ORDER BY k.ord ASC
    `,
    [tableName],
  );
  return rows.map((r) => String(r.column_name));
}

async function getNonPrimaryIndexes(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = $1
      AND indexname NOT LIKE '%_pkey'
    ORDER BY indexname ASC
    `,
    [tableName],
  );
  return rows.map((r) => String(r.indexdef));
}

function toColumnSql(def) {
  const isSerialDefault = def.columnDefault?.startsWith("nextval(");
  let typeSql = def.formattedType;
  let defaultSql = def.columnDefault ? ` DEFAULT ${def.columnDefault}` : "";

  if (isSerialDefault) {
    if (def.formattedType === "integer") {
      typeSql = "serial";
      defaultSql = "";
    } else if (def.formattedType === "bigint") {
      typeSql = "bigserial";
      defaultSql = "";
    }
  }

  const notNullSql = def.notNull ? " NOT NULL" : "";
  return `${quote(def.columnName)} ${typeSql}${defaultSql}${notNullSql}`;
}

function addIfNotExistsToIndex(indexDef) {
  if (/^CREATE\s+UNIQUE\s+INDEX\s+/i.test(indexDef)) {
    return indexDef.replace(/^CREATE\s+UNIQUE\s+INDEX\s+/i, "CREATE UNIQUE INDEX IF NOT EXISTS ");
  }
  if (/^CREATE\s+INDEX\s+/i.test(indexDef)) {
    return indexDef.replace(/^CREATE\s+INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ");
  }
  return indexDef;
}

async function ensureTargetTables(sourceClient, targetClient, sourceTables) {
  for (const tableName of sourceTables) {
    const exists = await tableExists(targetClient, tableName);
    if (exists) continue;

    const columnDefs = await getTableColumnDefs(sourceClient, tableName);
    if (columnDefs.length === 0) {
      throw new Error(`Could not read source table definition for public.${tableName}`);
    }

    const pkColumns = await getPrimaryKeyColumns(sourceClient, tableName);
    const pieces = columnDefs.map(toColumnSql);
    if (pkColumns.length > 0) {
      pieces.push(`PRIMARY KEY (${pkColumns.map((c) => quote(c)).join(", ")})`);
    }

    const createTableSql = `
      CREATE TABLE IF NOT EXISTS ${quote("public")}.${quote(tableName)} (
        ${pieces.join(",\n        ")}
      )
    `;
    await targetClient.query(createTableSql);

    const indexes = await getNonPrimaryIndexes(sourceClient, tableName);
    for (const indexDef of indexes) {
      await targetClient.query(addIfNotExistsToIndex(indexDef));
    }
    console.log(`Created missing table in target: ${tableName}`);
  }
}

async function resetSequences(client) {
  const { rows } = await client.query(`
    SELECT
      c.table_name,
      c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_default LIKE 'nextval(%'
    ORDER BY c.table_name
  `);

  for (const row of rows) {
    const tableName = String(row.table_name);
    const columnName = String(row.column_name);
    const sql = `
      SELECT setval(
        pg_get_serial_sequence('${quote("public")}.${quote(tableName)}', '${columnName}'),
        COALESCE((SELECT MAX(${quote(columnName)}) FROM ${quote("public")}.${quote(tableName)}), 0) + 1,
        false
      )
    `;
    await client.query(sql);
  }
}

async function maybeTruncateTarget(client, tables) {
  if (!truncateTarget || tables.length === 0) return;
  const fqTables = tables.map((t) => `${quote("public")}.${quote(t)}`).join(", ");
  await client.query(`TRUNCATE TABLE ${fqTables} RESTART IDENTITY CASCADE`);
}

async function run() {
  const startedAt = Date.now();
  const summary = [];
  try {
    const sourceTables = await getPublicTables(source);
    if (sourceTables.length === 0) {
      console.log("No public tables found in source database.");
      return;
    }

    await ensureTargetTables(source, target, sourceTables);

    await maybeTruncateTarget(target, sourceTables);

    for (const tableName of sourceTables) {
      const columnsMeta = await getColumnsMeta(source, tableName);
      if (columnsMeta.length === 0) {
        summary.push({ table: tableName, rows: 0 });
        continue;
      }

      const colNames = columnsMeta.map((c) => c.columnName);
      const pkCols = await getPrimaryKeyColumns(source, tableName);
      const orderCols = (pkCols.length > 0 ? pkCols : [colNames[0]])
        .map((c) => quote(c))
        .join(", ");
      let copiedRows = 0;
      let offset = 0;

      while (true) {
        const selectSql = `
          SELECT ${colNames.map((c) => quote(c)).join(", ")}
          FROM ${quote("public")}.${quote(tableName)}
          ORDER BY ${orderCols}
          LIMIT $1 OFFSET $2
        `;
        const { rows } = await source.query(selectSql, [batchSize, offset]);
        if (rows.length === 0) break;

        const insertSql = buildInsertSql(tableName, colNames, rows.length);
        const values = [];
        for (const row of rows) {
          for (const c of columnsMeta) {
            values.push(normalizeValue(row[c.columnName], c.udtName, c.dataType));
          }
        }
        await target.query(insertSql, values);
        copiedRows += rows.length;
        offset += rows.length;
      }

      if (copiedRows === 0) {
        summary.push({ table: tableName, rows: 0 });
        console.log(`Copied ${tableName}: 0 rows`);
        continue;
      }
      summary.push({ table: tableName, rows: copiedRows });
      console.log(`Copied ${tableName}: ${copiedRows} rows`);
    }

    await resetSequences(target);

    const totalRows = summary.reduce((sum, s) => sum + s.rows, 0);
    console.log("\nCopy complete.");
    console.log(`Tables copied: ${summary.length}`);
    console.log(`Total rows copied: ${totalRows}`);
    console.log(`Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
  } catch (error) {
    if (error && typeof error === "object") {
      const anyErr = error;
      console.error("DB copy failed:", {
        message: anyErr.message,
        code: anyErr.code,
        detail: anyErr.detail,
        hint: anyErr.hint,
        stack: anyErr.stack,
      });
    } else {
      console.error("DB copy failed:", String(error));
    }
    process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

run();
