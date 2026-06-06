# Admin dashboard — `/admin`

**Date:** 2026-06-06
**Branch:** feat/admin-dashboard off main
**Status:** Design — approved, pending spec review
**Builds on:** sessions/turns (intake + brain) and reports (PR #7). Project design doc admin section: `~/.gstack/projects/sheicky-ai-Customer-Service/...154811.md` (Build Plan step 7).

## Goal

A read-only `/admin` dashboard showing aggregate metrics across all interviews,
derived from the SQLite `sessions`, `turns`, and `reports` tables.

## Decisions (locked)

1. **No auth.** Per the user's explicit choice, `/admin` has no login/password
   gate — it is publicly viewable. This overrides the design doc's env-password
   requirement (R4). **Implication (accepted):** anyone with the URL sees aggregate
   metrics (company names, score averages/distribution); no individual CV or
   transcript is exposed. An env-password gate can be added later.
2. **Full derivable metric set** (see below), scoped to what the current tables support.
3. **Server component reads SQLite directly** — no API route, no client fetch.
   Aggregation is a pure function for testability.

## Out of scope

- Visual/design polish (hero hierarchy, warm empty state, responsive + a11y) —
  the existing deferred "admin dashboard polish" TODO, a separate spec. This builds
  a clean but functional layout.
- The env-password gate (no login, per the decision above).
- Per-session drill-down pages / viewing individual transcripts or reports.
- Charts/visualizations (counts and numbers as text/lists; charts can come with
  the polish pass).

## Current state

- `lib/db.ts` — `sessions` (`id, company, company_url, created_at, status, ended_at`),
  `turns` (`id, session_id, ts, role, text, phase, latency_ms`), `reports`
  (`session_id` PK, `created_at`, `json` — a stringified normalized `Report`).
  Has `getSession`, `getTurns`, `getReport`, etc. No "fetch all / aggregate" helpers.
- `lib/report.ts` — the `Report` type (`overall {score, band, verdict}`,
  `areas {technical, communication, role_fit, company_fit|null}`, plus arrays).
- `app/` — `page.tsx` (intake), `api/{llm,report,sessions}`. No `app/admin`.
- `session.status` is set to `'created'` and never updated, so "completion" is
  defined as **a session that has a report**, not via status.

## Target architecture

### `lib/db.ts` — read-only fetchers
```ts
export function getAllSessions(): SessionRow[] {
  return db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`).all() as SessionRow[];
}
export function getAllReports(): ReportRow[] {
  return db.prepare(`SELECT * FROM reports`).all() as ReportRow[];
}
/** Per-session count of candidate (role='user') turns — proxy for interview length. */
export function getCandidateTurnCounts(): number[] {
  const rows = db
    .prepare(`SELECT COUNT(*) AS n FROM turns WHERE role = 'user' GROUP BY session_id`)
    .all() as { n: number }[];
  return rows.map((r) => r.n);
}
```

### `lib/metrics.ts`
```ts
export interface Metrics {
  totalInterviews: number;
  reportsCount: number;
  completionRate: number;            // 0..1 (0 when no sessions)
  avgOverallScore: number | null;    // null when no reports
  bandDistribution: { strong: number; mixed: number; weak: number };
  avgAreaScores: {
    technical: number | null;
    communication: number | null;
    role_fit: number | null;
    company_fit: number | null;
  };
  topCompanies: { company: string; count: number }[];   // top 5 by count
  avgCandidateTurns: number | null;
  recentSessions: { id: string; company: string; created_at: string; overallScore: number | null }[]; // latest 10
}
```
- `computeMetrics({ sessions, reports, candidateTurnCounts }): Metrics` — **pure**.
  Exact input shape:
  - `sessions: SessionRow[]`
  - `reports: Array<{ session_id: string; report: Report }>` (already parsed; the
    `session_id` lets `recentSessions` attach each session's `overallScore`)
  - `candidateTurnCounts: number[]`
  - Averages round to integers; guard all divides by zero → `null`/`0`.
  - `company_fit` average uses only non-null `company_fit` scores.
  - `bandDistribution` counts each report's `overall.band` (already normalized to
    the enum by `parseReport`); unknown bands are ignored.
  - `topCompanies` groups `sessions.company`, sorts desc, takes 5.
  - `recentSessions` = first 10 of `sessions` (already DESC by `created_at`), each
    with `overallScore` from `reportsBySession` or null.
- `getMetrics(): Metrics` — wrapper: `getAllSessions()`, `getAllReports()` (→
  `{session_id, report: JSON.parse(row.json)}`), `getCandidateTurnCounts()`, then
  `computeMetrics(...)`. Tolerate a malformed stored report by skipping it
  (try/catch around `JSON.parse`), so one bad row can't break the whole page.

### `app/admin/page.tsx`
```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // always reflect current data
export default function AdminPage() {
  const m = getMetrics();
  // if m.totalInterviews === 0 → render empty state
  // else render: hero (total), cards (completion %, avg score, avg turns),
  //   band distribution, avg per-area scores, top companies, recent sessions table
}
```
- Server component; imports `getMetrics` from `@/lib/metrics`. No `"use client"`.
- Functional styling only (reuse `app/globals.css`; a small scoped block or inline
  styles are fine). Numbers/lists/table — no charts.
- Empty state: a plain "No interviews yet." message when there are zero sessions.

## Error handling

- `getMetrics` skips any report row whose `json` fails to parse (logged), so the
  dashboard renders from the valid rows.
- All metric divides guard against zero (return `null` for averages, `0` for rate).
- The page is read-only; no mutations, no user input.

## Verification

No external calls (DB + page only) — fully deterministic, no keys needed.

1. **`scripts/metrics-smoke.ts`** (`npm run check:metrics`) — asserts the pure
   `computeMetrics` on hand-built inputs:
   - empty input → `totalInterviews 0`, `completionRate 0`, `avgOverallScore null`,
     `bandDistribution {0,0,0}`, all `avgAreaScores` null, `topCompanies []`,
     `avgCandidateTurns null`, `recentSessions []`.
   - a mixed set (e.g. 3 sessions, 2 with reports — one with `company_fit`, one
     without): `completionRate` = 2/3, `avgOverallScore` = mean of the two,
     `bandDistribution` correct, `company_fit` average ignores the null,
     `topCompanies` ordered by count, `avgCandidateTurns` = mean of the counts,
     `recentSessions` attaches scores (null for the report-less session).
   - Pure: builds `SessionRow`/`Report` objects in-memory; no DB, no network.
2. `npx tsc --noEmit` and `npm run build` (build type-checks the server component).
3. README: document `/admin` (no auth, what it shows) + `check:metrics`.

## Risks / notes

- **No auth** — accepted; flagged for informed consent (see Decisions).
- **`force-dynamic`** ensures fresh data each load (the dashboard must not be
  statically cached at build time, when the DB is empty).
- **Scale:** `getAllSessions`/`getAllReports` read all rows; fine for a demo. If the
  corpus grows large, move aggregation into SQL (`json_extract` + `AVG`/`GROUP BY`)
  — noted, not done now (keeps `computeMetrics` pure and testable).
