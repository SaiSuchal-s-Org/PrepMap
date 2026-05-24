import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import { DEFAULT_UNIVERSITIES } from "../lib/appMetadata";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AccessTokenPayload } from "../lib/jwt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(process.cwd(), "artifacts/api-server/.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../.env"),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const { Pool } = pg;
const poolMax = Number(process.env.PGPOOL_MAX ?? "3");
const poolIdleTimeoutMs = Number(process.env.PGPOOL_IDLE_TIMEOUT_MS ?? "10000");
const poolConnectionTimeoutMs = Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS ?? "5000");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 3,
  idleTimeoutMillis:
    Number.isFinite(poolIdleTimeoutMs) && poolIdleTimeoutMs >= 0 ? poolIdleTimeoutMs : 10000,
  connectionTimeoutMillis:
    Number.isFinite(poolConnectionTimeoutMs) && poolConnectionTimeoutMs >= 0
      ? poolConnectionTimeoutMs
      : 5000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";

export async function withRequestDbContext<T>(
  claims: AccessTokenPayload | null,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.user_id', ${String(claims?.sub || "")}, true),
        set_config('app.role', ${String(claims?.role || "")}, true),
        set_config('app.university_id', ${String(claims?.universityId || "")}, true),
        set_config('app.batch', ${String(claims?.batch || "")}, true),
        set_config('app.branch', ${String(claims?.branch || "")}, true),
        set_config('app.year', ${String(claims?.year || "")}, true)
    `);
    return callback(tx);
  });
}

export async function initializeDatabase(): Promise<void> {
  const runBestEffort = async (label: string, statement: string) => {
    try {
      await pool.query(statement);
    } catch (error) {
      console.warn(`[db:init] non-fatal step skipped: ${label}`, error);
    }
  };

  await pool.query(`CREATE SCHEMA IF NOT EXISTS app;`);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_user_id()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.user_id', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.role', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_university_id()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.university_id', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_batch()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.batch', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_branch()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.branch', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_year()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('app.year', true), '')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_normalize_token(value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT regexp_replace(lower(coalesce(value, '')), '\\s+', '', 'g')
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_parse_year_number(value text)
    RETURNS integer
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      token text := public.app_normalize_token(value);
      matches text[];
    BEGIN
      matches := regexp_match(token, 'year[^0-9]*([1-4])');
      IF matches IS NOT NULL THEN
        RETURN matches[1]::integer;
      END IF;

      matches := regexp_match(token, '^([1-4])$');
      IF matches IS NOT NULL THEN
        RETURN matches[1]::integer;
      END IF;

      RETURN NULL;
    END;
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_parse_semester_number(value text)
    RETURNS integer
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      token text := public.app_normalize_token(value);
      matches text[];
    BEGIN
      matches := regexp_match(token, 'sem(?:ester)?[^0-9]*([1-8])');
      IF matches IS NOT NULL THEN
        RETURN matches[1]::integer;
      END IF;

      matches := regexp_match(token, '^s([1-8])$');
      IF matches IS NOT NULL THEN
        RETURN matches[1]::integer;
      END IF;

      matches := regexp_match(token, '^([1-8])$');
      IF matches IS NOT NULL THEN
        RETURN matches[1]::integer;
      END IF;

      RETURN NULL;
    END;
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION public.app_student_year_matches_config_year(user_year text, config_year text)
    RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      config_token text := public.app_normalize_token(config_year);
      user_token text := public.app_normalize_token(user_year);
      year_num integer;
      sem_num integer;
      mapped_year integer;
    BEGIN
      IF config_token = '' OR user_token = '' THEN
        RETURN false;
      END IF;

      IF config_token = user_token THEN
        RETURN true;
      END IF;

      year_num := public.app_parse_year_number(user_year);
      IF year_num IS NOT NULL THEN
        IF config_token IN (
          year_num::text,
          'year' || year_num::text,
          'sem' || (year_num * 2 - 1)::text,
          'sem' || (year_num * 2)::text,
          'semester' || (year_num * 2 - 1)::text,
          'semester' || (year_num * 2)::text
        ) THEN
          RETURN true;
        END IF;
      END IF;

      sem_num := public.app_parse_semester_number(user_year);
      IF sem_num IS NOT NULL THEN
        mapped_year := ceil(sem_num / 2.0);
        IF config_token IN (
          'sem' || sem_num::text,
          'semester' || sem_num::text,
          mapped_year::text,
          'year' || mapped_year::text
        ) THEN
          RETURN true;
        END IF;
      END IF;

      RETURN false;
    END;
    $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.universities (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  for (const u of DEFAULT_UNIVERSITIES) {
    await pool.query(
      `
      INSERT INTO public.universities (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `,
      [u.id, u.name],
    );
  }

  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS name text;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS batch text NOT NULL DEFAULT '2025';
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS must_reset_password boolean NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ALTER COLUMN must_reset_password SET DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS security_question text;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS security_answer_hash text;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_successful_login_at timestamp without time zone;
  `);
  await pool.query(`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_password_reset_at timestamp without time zone;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.users
    ADD COLUMN IF NOT EXISTS created_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.users
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.universities
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.auth_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      refresh_token_hash text NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now(),
      last_activity_at timestamp without time zone NOT NULL DEFAULT now(),
      expires_at timestamp without time zone NOT NULL
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_refresh_token_hash_unique
    ON public.auth_sessions (refresh_token_hash);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
    ON public.auth_sessions (user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON public.auth_sessions (expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.subjects (
      id text PRIMARY KEY,
      name text NOT NULL,
      normalized_name text NOT NULL,
      created_by text NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS subjects_normalized_name_unique
    ON public.subjects (normalized_name);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.unit_library (
      id text PRIMARY KEY,
      subject_id text NOT NULL,
      unit_title text NOT NULL,
      normalized_unit_title text NOT NULL,
      topics jsonb NOT NULL DEFAULT '[]'::jsonb,
      source_text text,
      created_by text NOT NULL,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS unit_library_subject_unit_unique
    ON public.unit_library (subject_id, normalized_unit_title);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.config_unit_links (
      id text PRIMARY KEY,
      config_id text NOT NULL,
      unit_library_id text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.config_unit_links
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS config_unit_links_unique
    ON public.config_unit_links (config_id, unit_library_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.canonical_nodes (
      id text PRIMARY KEY,
      subject_id text NOT NULL,
      unit_library_id text NOT NULL,
      title text NOT NULL,
      normalized_title text,
      type text NOT NULL,
      parent_canonical_node_id text,
      explanation text,
      learning_goal text,
      example_block text,
      support_note text,
      prerequisite_titles text,
      prerequisite_node_ids text,
      next_recommended_titles text,
      next_recommended_node_ids text,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS canonical_nodes_subject_idx
    ON public.canonical_nodes (subject_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS canonical_nodes_unit_idx
    ON public.canonical_nodes (unit_library_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS canonical_nodes_parent_idx
    ON public.canonical_nodes (parent_canonical_node_id);
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.canonical_nodes
    ADD COLUMN IF NOT EXISTS normalized_title text;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS canonical_nodes_subject_norm_title_idx
    ON public.canonical_nodes (subject_id, normalized_title);
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS canonical_node_id text;
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.nodes
    ADD COLUMN IF NOT EXISTS normalized_title text;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_config_norm_title_idx
    ON public.nodes (config_id, normalized_title);
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.nodes
    ADD COLUMN IF NOT EXISTS created_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.nodes
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.configs
    ADD COLUMN IF NOT EXISTS batch text NOT NULL DEFAULT '2025';
  `);

  await runBestEffort(
    "events_add_batch",
    `
    ALTER TABLE IF EXISTS public.events
    ADD COLUMN IF NOT EXISTS batch text NOT NULL DEFAULT '2025';
  `,
  );

  await pool.query(`
    ALTER TABLE IF EXISTS public.configs
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `);

  await runBestEffort(
    "events_add_created_at",
    `
    ALTER TABLE IF EXISTS public.events
    ADD COLUMN IF NOT EXISTS created_at timestamp without time zone NOT NULL DEFAULT now();
  `,
  );

  await runBestEffort(
    "events_add_updated_at",
    `
    ALTER TABLE IF EXISTS public.events
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT now();
  `,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.config_consolidated_stats (
      config_id text PRIMARY KEY REFERENCES public.configs(id) ON DELETE CASCADE,
      university_id text NOT NULL,
      batch text NOT NULL,
      year text NOT NULL,
      branch text NOT NULL,
      subject text NOT NULL,
      exam text NOT NULL,
      status text NOT NULL,
      total_events integer NOT NULL DEFAULT 0,
      total_students_in_batch integer NOT NULL DEFAULT 0,
      eligible_student_count integer NOT NULL DEFAULT 0,
      unique_students_content integer NOT NULL DEFAULT 0,
      unique_students_qb integer NOT NULL DEFAULT 0,
      avg_content_consumption_pct real NOT NULL DEFAULT 0,
      avg_qb_consumption_pct real NOT NULL DEFAULT 0,
      students_completed_content integer NOT NULL DEFAULT 0,
      students_completed_qb integer NOT NULL DEFAULT 0,
      students_completed_both integer NOT NULL DEFAULT 0,
      content_total_targets integer NOT NULL DEFAULT 0,
      qb_total_targets integer NOT NULL DEFAULT 0,
      snapshot_version text NOT NULL DEFAULT 'v1',
      consolidated_at timestamp without time zone NOT NULL DEFAULT now(),
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS config_consolidated_stats_university_batch_idx
    ON public.config_consolidated_stats (university_id, batch);
  `);

  await runBestEffort(
    "events_add_question_id",
    `
    ALTER TABLE IF EXISTS public.events
    ADD COLUMN IF NOT EXISTS question_id text;
  `,
  );

  await runBestEffort(
    "events_drop_topic_subtopic_not_null",
    `
    ALTER TABLE IF EXISTS public.events
    ALTER COLUMN topic_id DROP NOT NULL,
    ALTER COLUMN subtopic_id DROP NOT NULL;
  `,
  );

  await runBestEffort(
    "events_question_idx",
    `
    CREATE INDEX IF NOT EXISTS events_question_idx
    ON public.events (question_id);
  `,
  );

  await runBestEffort(
    "events_enable_rls",
    `
    ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
  `,
  );

  await runBestEffort(
    "events_force_rls",
    `
    ALTER TABLE public.events FORCE ROW LEVEL SECURITY;
  `,
  );

  await pool.query(`
    ALTER TABLE public.configs ENABLE ROW LEVEL SECURITY;
  `);

  await pool.query(`
    ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;
  `);

  await pool.query(`
    ALTER TABLE public.config_questions ENABLE ROW LEVEL SECURITY;
  `);

  await pool.query(`
    ALTER TABLE public.config_replica_questions ENABLE ROW LEVEL SECURITY;
  `);

  // Legacy tables (subtopic_contents, subtopic_questions) are intentionally
  // not created/managed here. The app uses canonical/config-scoped tables.

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS subject_id text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS unit_library_id text;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_config_canonical_idx
    ON public.nodes (config_id, canonical_node_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_subject_idx
    ON public.nodes (subject_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_unit_library_idx
    ON public.nodes (unit_library_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.config_questions (
      id bigserial PRIMARY KEY,
      config_id text NOT NULL,
      unit_subtopic_id text,
      mark_type text NOT NULL,
      question text NOT NULL,
      answer text NOT NULL,
      is_starred boolean NOT NULL DEFAULT false,
      star_source text NOT NULL DEFAULT 'none',
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.config_replica_questions (
      id bigserial PRIMARY KEY,
      config_id text NOT NULL,
      mark_type text NOT NULL,
      question text NOT NULL,
      answer text NOT NULL,
      unit_title text,
      topic_title text,
      subtopic_title text,
      is_starred boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp without time zone NOT NULL DEFAULT now(),
      updated_at timestamp without time zone NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.config_replica_questions
    ALTER COLUMN unit_title DROP NOT NULL,
    ALTER COLUMN topic_title DROP NOT NULL,
    ALTER COLUMN subtopic_title DROP NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS config_replica_questions_config_idx
    ON public.config_replica_questions (config_id);
  `);

  await pool.query(`
    ALTER TABLE IF EXISTS public.config_questions
    ALTER COLUMN unit_subtopic_id DROP NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS config_questions_config_idx
    ON public.config_questions (config_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS config_questions_subtopic_idx
    ON public.config_questions (unit_subtopic_id);
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS unit_topic_id text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS unit_subtopic_id text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS learning_goal text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS example_block text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS support_note text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS prerequisite_titles text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS prerequisite_node_ids text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS next_recommended_titles text;
  `);

  await pool.query(`
    ALTER TABLE public.nodes
    ADD COLUMN IF NOT EXISTS next_recommended_node_ids text;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_config_unit_topic_idx
    ON public.nodes (config_id, unit_topic_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS nodes_config_unit_subtopic_idx
    ON public.nodes (config_id, unit_subtopic_id);
  `);

}
