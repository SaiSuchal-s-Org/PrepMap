# PrepMap

PrepMap is an exam-readiness platform for universities.

- Admins create and publish subject configs (roadmaps + question banks).
- Students and super-students consume live roadmaps and question banks.
- Student activity is tracked for analytics.

## Monorepo Structure

- `artifacts/api-server` - Express + TypeScript backend
- `artifacts/exam-roadmap` - React + Vite frontend
- `api/[...path].ts` - Vercel API entrypoint for backend mounting
- `lib/*` - shared packages/schema/client generation

## Roles and Access Model

- `admin`
  - full admin routes and write actions
- `student`
  - learner access, filtered by university + year/branch/batch constraints
- `super_student`
  - learner experience with broader viewing scope than `student`
  - not an admin role

Important: `super_student` does not get admin privileges; admin routes are guarded by explicit role checks.

## Product Flow

1. Admin creates a config (university, semester, exam, subject, batch context).
2. Admin uploads syllabus/replica inputs or uses library-based structure.
3. Generation produces structure, explanations, and question bank.
4. Admin reviews and publishes config as `live`.
5. Students consume roadmap and question bank; events feed analytics.

## Tech Stack

- Backend: Node.js, Express 5, TypeScript, Drizzle ORM, PostgreSQL
- Frontend: React, Vite, TypeScript, Tailwind, TanStack Query, Wouter
- Storage: Supabase Storage
- AI: `anthropic` or `openai`
- Tooling: pnpm workspace, esbuild

## Prerequisites

- Node.js `22.x` or `24.x`
- pnpm `10.x` (via Corepack)
- PostgreSQL (Supabase Postgres supported)

## Local Setup

1. Install dependencies

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
```

2. Backend env

- copy `artifacts/api-server/.env.example` to `artifacts/api-server/.env`
- fill required values (see Environment Variables section)

3. Frontend env

- copy `artifacts/exam-roadmap/.env.example` to `artifacts/exam-roadmap/.env`
- set `VITE_API_BASE_URL` only if frontend and backend are not same-origin

4. Run

```bash
pnpm run dev
```

- API: `http://localhost:4000`
- Web: `http://localhost:5173`

## Environment Variables (Backend)

Required:

- `DATABASE_URL`
- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `AI_PROVIDER` (`anthropic` or `openai`)
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (matching provider)

Common optional:

- `PORT` (default handled by platform)
- `JWT_ACCESS_TTL_SECONDS`
- `LOG_LEVEL`
- `API_BODY_LIMIT`
- `PGPOOL_MAX`
- `PGPOOL_IDLE_TIMEOUT_MS`
- `PGPOOL_CONNECTION_TIMEOUT_MS`

## Scripts

Root:

- `pnpm run dev` - run API + web
- `pnpm run build` - typecheck + API build + web build
- `pnpm run typecheck` - API + web typecheck

API package (`artifacts/api-server`):

- `pnpm run dev`
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm run import:students ...`

Web package (`artifacts/exam-roadmap`):

- `pnpm run dev`
- `pnpm run build`
- `pnpm run typecheck`

## Student Import

Bulk import command:

```bash
corepack pnpm --dir artifacts/api-server run import:students ./path/to/students.tsv CSE
```

Importer behavior:

- temporary password seeded from student id
- `must_reset_password=true`
- security question fields cleared
- existing ids are upserted

## Deployments

### Current recommended (cost-aware)

- Frontend: Vercel
- Backend + DB + storage: keep your current existing stack (Supabase-backed) unless AWS cost is justified

### Vercel frontend-only notes

- set project root to `artifacts/exam-roadmap`
- use frontend env var: `VITE_API_BASE_URL=https://<backend-url>`
- ensure SPA rewrite exists for refresh-safe routing:
  - `artifacts/exam-roadmap/vercel.json`

### AWS path (optional / later)

Containerized backend path exists (Docker + ECR + ECS), but use only when traffic/control needs justify cost.

## Security Checklist

- never commit `.env` or local secret files
- rotate keys immediately if exposed in logs/screenshots/commits
- prefer platform secret stores for production
- use IAM user credentials, not root, for AWS CLI

## Troubleshooting

- Refresh gives 404 on frontend routes:
  - add SPA rewrite in `artifacts/exam-roadmap/vercel.json`
- Docker env parsing error:
  - remove spaces around `KEY=value`
- Push blocked by GitHub secret scanning:
  - remove secrets from commit history, not only current files
- ECS task fails during startup with DB constraint errors:
  - fix violating rows or align constraints with business rules before redeploy

## What Changed Recently

- Topic-content loading and caching strategy improved to reduce payload/egress.
- `super_student` behavior separated from admin privileges.
- DB constraints aligned with role semantics (batch/name checks updated).

