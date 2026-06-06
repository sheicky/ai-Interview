# SQLite → libSQL (Turso) migration — Vercel-ready persistence

**Date:** 2026-06-07
**Branch:** feat/libsql-migration off main
**Status:** Design — approved, pending implementation
**Why:** Prerequisite for deploying on Vercel. `better-sqlite3` writes a file on local disk; Vercel serverless has an ephemeral filesystem, so sessions/turns/reports would silently vanish in production.

## Goal

Replace `better-sqlite3` (local-disk SQLite) with **`@libsql/client`** so the same
SQL/schema runs against a local file in dev and **Turso** (libSQL) in production —
making the app persist correctly on Vercel. No schema or behavior changes; the DB
API just becomes async.

## Decisions (locked)

1. **`@libsql/client`** (libSQL — SQLite-compatible). Dev/test point at a local
   `file:` DB (no Turso creds needed); Vercel points at the Turso URL via env.
2. **Same schema, same SQL** — sessions/turns/reports unchanged. Only the call
   surface changes from sync to **async**.
3. **Env-driven URL:** `DATABASE_URL` (default `file:<DATA_DIR>/app.db`) +
   `DATABASE_AUTH_TOKEN` (Turso only).

## Out of scope

- The voice feature and the Vercel deploy itself (separate PR B).
- Any change to the RAG layer (`lib/rag.ts` uses Pinecone, not SQLite — untouched).
- Data migration of existing local `.data/app.db` rows (dev-only throwaway data).

## Current state

- `lib/db.ts` — `better-sqlite3`, synchronous: `db.prepare(...).run/get/all(...)`.
  Tables created at import via `db.exec(...)`. Exports `createSession`,
  `deleteSession`, `getSession`, `addTurn`, `getTurns`, `getReport`, `saveReport`,
  `deleteReport`, `getAllSessions`, `getAllReports`, `getCandidateTurnCounts`, the
  row interfaces, and `default db`.
- **Sync callers that must `await`:** `app/api/sessions/route.ts`,
  `app/api/report/route.ts`, `app/api/chat/route.ts` + `app/api/llm/route.ts` (via
  `lib/brain.ts`), `lib/brain.ts` (`addTurn`), `lib/metrics.ts` (`getMetrics`),
  `app/admin/page.tsx` (`getMetrics`), `app/report/[sessionId]/page.tsx`
  (`getReport`), and the 5 `scripts/*-smoke.ts`.
- `lib/report.ts` imports only the `TurnRow` *type* — unaffected. `lib/rag.ts`
  imports nothing executable from db — unaffected.

## Target

### Dependencies
- Remove `better-sqlite3` + `@types/better-sqlite3`. Add `@libsql/client@^0.17.3`.

### `lib/db.ts` (rewrite, same schema)
```ts
import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

// Local dev/test: a file DB under DATA_DIR. Production (Vercel): Turso libsql:// URL.
function makeUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  mkdirSync(DATA_DIR, { recursive: true }); // file: needs the dir to exist
  return `file:${join(DATA_DIR, "app.db")}`;
}

const db: Client = createClient({
  url: makeUrl(),
  authToken: process.env.DATABASE_AUTH_TOKEN, // undefined for file: URLs — fine
});

// Schema created once; every query awaits this first.
let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = db
      .batch(
        [
          `CREATE TABLE IF NOT EXISTS sessions (
             id TEXT PRIMARY KEY, company TEXT NOT NULL, company_url TEXT,
             created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created', ended_at TEXT)`,
          `CREATE TABLE IF NOT EXISTS turns (
             id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts TEXT NOT NULL,
             role TEXT NOT NULL, text TEXT NOT NULL, phase TEXT, latency_ms INTEGER)`,
          `CREATE TABLE IF NOT EXISTS reports (
             session_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL)`,
        ],
        "write",
      )
      .then(() => undefined)
      .catch((err) => {
        ready = null; // don't cache a failed init (mirrors the lazy-singleton pattern elsewhere)
        throw err;
      });
  }
  return ready;
}
```
- Every exported function becomes `async`, does `await ensureReady()`, then
  `await db.execute({ sql, args })`. Reads return `res.rows`; map via
  `res.rows as unknown as SessionRow[]` (libSQL rows are column-keyed objects).
  Single-row getters return `rows[0] as ... | undefined`.
- Row interfaces unchanged (`SessionRow`, `TurnRow`, `ReportRow`). Keep the
  `default db` export (the client) for parity.
- Example shapes:
  - `createSession(s)`: `await db.execute({ sql: "INSERT INTO sessions (...) VALUES (?,?,?,?,'created')", args: [s.id, s.company, s.companyUrl ?? null, new Date().toISOString()] })`.
  - `getSession(id)`: `(await db.execute({ sql: "SELECT * FROM sessions WHERE id = ?", args: [id] })).rows[0] as unknown as SessionRow | undefined`.
  - `getCandidateTurnCounts()`: map rows' `n` (cast `Number(r.n)` — libSQL may return INTEGER as bigint).
- `latency_ms`/`phase` nullable handled by passing `?? null`.

### Caller updates (mechanical — add `await`, mark `async` where needed)
- `app/api/sessions/route.ts`: `await createSession(...)`, `await deleteSession(...)`.
- `app/api/report/route.ts`: `await getSession`, `await getReport`, `await getTurns`, `await saveReport`.
- `lib/brain.ts`: `await addTurn(...)` in the stream `finally` (already in an async fn).
- `lib/metrics.ts`: `getMetrics` becomes `async`, `await`s the three fetchers.
- `app/admin/page.tsx`: `export default async function AdminPage()`, `const m = await getMetrics()`.
- `app/report/[sessionId]/page.tsx`: `const row = await getReport(sessionId)` (already async).
- `app/api/llm/route.ts` + `app/api/chat/route.ts`: `await getSession(...)`.
- `scripts/{rag,llm,chat,report,metrics}-smoke.ts`: `await` the db calls (`createSession`, `addTurn`, `getReport`, `deleteSession`, `deleteReport`).

### Env
- `.env`: `DATABASE_URL` unset locally (defaults to file). `.env.example`: document
  `DATABASE_URL=libsql://<db>.turso.io` + `DATABASE_AUTH_TOKEN=...` for production,
  noting local dev needs neither (defaults to `file:.data/app.db`).

## Verification

The 5 live smokes already exercise nearly every DB path; they are the regression net.
1. `npm run check:metrics` — pure `computeMetrics` (no DB) still passes.
2. `npm run check:isolation` — RAG round-trip (no DB change, sanity).
3. `npm run check:brain` — `/api/llm` (getSession + addTurn logging) against the file DB + live OpenRouter/Pinecone.
4. `npm run check:chat` — `/api/chat` (getSession + logging).
5. `npm run check:report` — createSession + addTurn + getTurns + saveReport + getReport + cache/force/422 + cleanup.
6. `npx tsc --noEmit` and `npm run build` pass.
All run locally against the default `file:` DB — no Turso account needed to verify. Do NOT weaken any smoke.

## Risks / notes

- **Async ripple is broad but mechanical.** The smoke suite + build catch a missed `await` (would surface as a Promise where a row is expected, failing an assertion or tsc).
- **bigint:** libSQL may return INTEGER columns as `bigint`; coerce counts with `Number(...)` where used numerically (`getCandidateTurnCounts`, `turns.id` only flows through as a value, not math).
- **Vercel:** set `DATABASE_URL` (Turso `libsql://…`) + `DATABASE_AUTH_TOKEN` as Vercel env vars in PR B's deploy step. Turso free tier is sufficient.
- **`@libsql/client` is serverless-safe** (no native-file dependency on Vercel when using the remote URL).
