# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/admin` dashboard showing aggregate interview metrics from the SQLite `sessions`/`turns`/`reports` tables (no auth).

**Architecture:** A server component (`app/admin/page.tsx`, `force-dynamic`) calls `getMetrics()` which reads the DB and delegates to a pure `computeMetrics()` aggregator in `lib/metrics.ts`. New read-only fetchers live in `lib/db.ts`. The pure aggregator is unit-tested with no DB/network.

**Tech Stack:** Next.js 16 (nodejs runtime, server component), TypeScript, `better-sqlite3`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-06-admin-dashboard-design.md`

---

## File Structure

- **Modify** `lib/db.ts` — `getAllSessions`, `getAllReports`, `getCandidateTurnCounts`.
- **Create** `lib/metrics.ts` — `Metrics` type, pure `computeMetrics`, `getMetrics` wrapper.
- **Create** `app/admin/page.tsx` — server component dashboard.
- **Create** `scripts/metrics-smoke.ts` + **modify** `package.json` — `check:metrics` (pure).
- **Modify** `README.md` — document `/admin` + `check:metrics`.

---

## Task 1: Add read-only fetchers to `lib/db.ts`

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add the three fetchers**

Append after `deleteReport` (which exists), before `export default db;`:
```ts
/** All sessions, newest first. */
export function getAllSessions(): SessionRow[] {
  return db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`).all() as SessionRow[];
}

/** All stored reports. */
export function getAllReports(): ReportRow[] {
  return db.prepare(`SELECT * FROM reports`).all() as ReportRow[];
}

/** Per-session count of candidate (role='user') turns — a proxy for interview length. */
export function getCandidateTurnCounts(): number[] {
  const rows = db
    .prepare(`SELECT COUNT(*) AS n FROM turns WHERE role = 'user' GROUP BY session_id`)
    .all() as { n: number }[];
  return rows.map((r) => r.n);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`SessionRow` and `ReportRow` are already declared in db.ts.)

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add admin read-only DB fetchers"
```

---

## Task 2: Create `lib/metrics.ts`

**Files:**
- Create: `lib/metrics.ts`

- [ ] **Step 1: Write the metrics module**

```ts
/**
 * Admin metrics. `computeMetrics` is pure (testable without a DB); `getMetrics`
 * wires the DB fetchers to it.
 */
import { getAllSessions, getAllReports, getCandidateTurnCounts, type SessionRow } from "./db";
import type { Report } from "./report";

export interface Metrics {
  totalInterviews: number;
  reportsCount: number;
  completionRate: number; // 0..1
  avgOverallScore: number | null;
  bandDistribution: { strong: number; mixed: number; weak: number };
  avgAreaScores: {
    technical: number | null;
    communication: number | null;
    role_fit: number | null;
    company_fit: number | null;
  };
  topCompanies: { company: string; count: number }[];
  avgCandidateTurns: number | null;
  recentSessions: {
    id: string;
    company: string;
    created_at: string;
    overallScore: number | null;
  }[];
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/** Pure aggregator over already-fetched rows. */
export function computeMetrics(input: {
  sessions: SessionRow[];
  reports: { session_id: string; report: Report }[];
  candidateTurnCounts: number[];
}): Metrics {
  const { sessions, reports, candidateTurnCounts } = input;

  const totalInterviews = sessions.length;
  const reportsCount = reports.length;

  const bandDistribution = { strong: 0, mixed: 0, weak: 0 };
  for (const { report } of reports) {
    const b = report.overall?.band;
    if (b === "strong" || b === "mixed" || b === "weak") bandDistribution[b]++;
  }

  const areaAvg = (pick: (r: Report) => number | null | undefined): number | null =>
    avg(
      reports
        .map(({ report }) => pick(report))
        .filter((n): n is number => typeof n === "number"),
    );

  const companyCounts = new Map<string, number>();
  for (const s of sessions) companyCounts.set(s.company, (companyCounts.get(s.company) ?? 0) + 1);
  const topCompanies = [...companyCounts.entries()]
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const scoreBySession = new Map(
    reports.map(({ session_id, report }) => [session_id, report.overall?.score ?? null]),
  );
  const recentSessions = sessions.slice(0, 10).map((s) => ({
    id: s.id,
    company: s.company,
    created_at: s.created_at,
    overallScore: scoreBySession.get(s.id) ?? null,
  }));

  return {
    totalInterviews,
    reportsCount,
    completionRate: totalInterviews > 0 ? reportsCount / totalInterviews : 0,
    avgOverallScore: avg(reports.map(({ report }) => report.overall?.score).filter((n): n is number => typeof n === "number")),
    bandDistribution,
    avgAreaScores: {
      technical: areaAvg((r) => r.areas?.technical?.score),
      communication: areaAvg((r) => r.areas?.communication?.score),
      role_fit: areaAvg((r) => r.areas?.role_fit?.score),
      company_fit: areaAvg((r) => r.areas?.company_fit?.score ?? null),
    },
    topCompanies,
    avgCandidateTurns: avg(candidateTurnCounts),
    recentSessions,
  };
}

/** Read the DB and compute metrics. Skips any report row with malformed JSON. */
export function getMetrics(): Metrics {
  const reports: { session_id: string; report: Report }[] = [];
  for (const row of getAllReports()) {
    try {
      reports.push({ session_id: row.session_id, report: JSON.parse(row.json) as Report });
    } catch (err) {
      console.error("[metrics] skipping malformed report for", row.session_id, err);
    }
  }
  return computeMetrics({
    sessions: getAllSessions(),
    reports,
    candidateTurnCounts: getCandidateTurnCounts(),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/metrics.ts
git commit -m "feat: add admin metrics aggregator"
```

---

## Task 3: Create `app/admin/page.tsx`

**Files:**
- Create: `app/admin/page.tsx`

- [ ] **Step 1: Write the server-component dashboard**

```tsx
/**
 * /admin — read-only aggregate metrics dashboard. Server component; reads SQLite
 * directly on each request. No auth (publicly viewable, by design).
 */
import { getMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "2rem",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#1a1a1a",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "1rem",
  margin: "1rem 0 2rem",
};
const card: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  padding: "1rem",
};
const big: React.CSSProperties = { fontSize: "2rem", fontWeight: 700, margin: 0 };
const label: React.CSSProperties = { fontSize: "0.8rem", color: "#666", margin: "0 0 0.25rem" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "2px solid #e5e5e5", padding: "0.5rem" };
const td: React.CSSProperties = { borderBottom: "1px solid #f0f0f0", padding: "0.5rem" };

function score(n: number | null): string {
  return n == null ? "—" : String(n);
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div style={card}>
      <p style={label}>{title}</p>
      <p style={big}>{value}</p>
    </div>
  );
}

export default function AdminPage() {
  const m = getMetrics();

  if (m.totalInterviews === 0) {
    return (
      <main style={page}>
        <h1>Admin</h1>
        <p style={{ color: "#666" }}>No interviews yet.</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1>Admin</h1>

      <section style={grid}>
        <Stat title="Total interviews" value={String(m.totalInterviews)} />
        <Stat title="Completion rate" value={`${Math.round(m.completionRate * 100)}%`} />
        <Stat title="Avg overall score" value={score(m.avgOverallScore)} />
        <Stat title="Avg candidate turns" value={score(m.avgCandidateTurns)} />
      </section>

      <h2>Score bands</h2>
      <section style={grid}>
        <Stat title="Strong" value={String(m.bandDistribution.strong)} />
        <Stat title="Mixed" value={String(m.bandDistribution.mixed)} />
        <Stat title="Weak" value={String(m.bandDistribution.weak)} />
      </section>

      <h2>Average area scores</h2>
      <section style={grid}>
        <Stat title="Technical" value={score(m.avgAreaScores.technical)} />
        <Stat title="Communication" value={score(m.avgAreaScores.communication)} />
        <Stat title="Role fit" value={score(m.avgAreaScores.role_fit)} />
        <Stat title="Company fit" value={score(m.avgAreaScores.company_fit)} />
      </section>

      <h2>Top companies</h2>
      {m.topCompanies.length === 0 ? (
        <p style={{ color: "#666" }}>None.</p>
      ) : (
        <ul>
          {m.topCompanies.map((c) => (
            <li key={c.company}>
              {c.company} — {c.count}
            </li>
          ))}
        </ul>
      )}

      <h2>Recent sessions</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Company</th>
            <th style={th}>Created</th>
            <th style={th}>Score</th>
          </tr>
        </thead>
        <tbody>
          {m.recentSessions.map((s) => (
            <tr key={s.id}>
              <td style={td}>{s.company}</td>
              <td style={td}>{new Date(s.created_at).toLocaleString()}</td>
              <td style={td}>{score(s.overallScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed; `/admin` appears in the build route list. (If the build tries to statically prerender `/admin` and fails because the DB is empty, `dynamic = "force-dynamic"` prevents prerender — confirm it's marked dynamic, ƒ, not static, ○.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: add /admin metrics dashboard (server component, no auth)"
```

---

## Task 4: Pure metrics smoke test

**Files:**
- Create: `scripts/metrics-smoke.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the smoke script**

```ts
/**
 * Deterministic unit checks for computeMetrics. No DB, no network. Run:
 *   npm run check:metrics
 */
import { strict as assert } from "node:assert";
import { computeMetrics } from "../lib/metrics";
import type { SessionRow } from "../lib/db";
import type { Report } from "../lib/report";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

function session(id: string, company: string, created_at: string): SessionRow {
  return { id, company, company_url: null, created_at, status: "created", ended_at: null };
}

function report(overall: number, band: "strong" | "mixed" | "weak", companyFit: number | null): Report {
  return {
    overall: { score: overall, band, verdict: "v" },
    areas: {
      technical: { score: 80, comment: "" },
      communication: { score: 70, comment: "" },
      role_fit: { score: 60, comment: "" },
      company_fit: companyFit == null ? null : { score: companyFit, comment: "" },
    },
    strengths: [],
    gaps: [],
    notable_moments: [],
    next_steps: [],
  };
}

// --- empty input ---
const empty = computeMetrics({ sessions: [], reports: [], candidateTurnCounts: [] });
assert.equal(empty.totalInterviews, 0);
assert.equal(empty.completionRate, 0);
assert.equal(empty.avgOverallScore, null);
assert.deepEqual(empty.bandDistribution, { strong: 0, mixed: 0, weak: 0 });
assert.deepEqual(empty.avgAreaScores, { technical: null, communication: null, role_fit: null, company_fit: null });
assert.deepEqual(empty.topCompanies, []);
assert.equal(empty.avgCandidateTurns, null);
assert.deepEqual(empty.recentSessions, []);
ok("empty input → zeros/nulls");

// --- mixed set: 3 sessions, 2 reports (one with company_fit, one without) ---
const sessions = [
  session("11111111-1111-4111-8111-111111111111", "Acme", "2026-06-01T10:00:00Z"),
  session("22222222-2222-4222-8222-222222222222", "Acme", "2026-06-02T10:00:00Z"),
  session("33333333-3333-4333-8333-333333333333", "Globex", "2026-06-03T10:00:00Z"),
];
const reports = [
  { session_id: "11111111-1111-4111-8111-111111111111", report: report(90, "strong", 50) },
  { session_id: "22222222-2222-4222-8222-222222222222", report: report(60, "mixed", null) },
];
const m = computeMetrics({ sessions, reports, candidateTurnCounts: [4, 6] });

assert.equal(m.totalInterviews, 3);
assert.equal(m.reportsCount, 2);
assert.ok(Math.abs(m.completionRate - 2 / 3) < 1e-9, "completion rate 2/3");
assert.equal(m.avgOverallScore, 75, "avg overall (90+60)/2");
assert.deepEqual(m.bandDistribution, { strong: 1, mixed: 1, weak: 0 });
assert.equal(m.avgAreaScores.company_fit, 50, "company_fit average ignores the null");
assert.equal(m.avgAreaScores.technical, 80);
assert.equal(m.avgCandidateTurns, 5, "avg of [4,6]");
assert.deepEqual(m.topCompanies, [
  { company: "Acme", count: 2 },
  { company: "Globex", count: 1 },
], "top companies ordered by count");
// recentSessions: sessions are passed newest-first already; scores attached, null where no report
assert.equal(m.recentSessions.length, 3);
assert.equal(m.recentSessions[0].company, "Acme");
const scoreFor = (id: string) => m.recentSessions.find((s) => s.id === id)!.overallScore;
assert.equal(scoreFor("33333333-3333-4333-8333-333333333333"), null, "report-less session → null score");
assert.equal(scoreFor("11111111-1111-4111-8111-111111111111"), 90);
ok("mixed set → correct aggregates");

console.log("\nALL METRICS CHECKS PASSED");
```

- [ ] **Step 2: Add the `check:metrics` npm script**

In `package.json` `"scripts"`, add after `check:report` (no `--env-file` — this test needs no secrets):
```json
    "check:report": "node --env-file=.env --import tsx scripts/report-smoke.ts",
    "check:metrics": "node --import tsx scripts/metrics-smoke.ts"
```
(Keep the comma after the `check:report` line.)

- [ ] **Step 3: Run it**

Run: `npm run check:metrics`
Expected: ends with `ALL METRICS CHECKS PASSED`. No network, no keys. Do NOT weaken assertions — a failure is a real bug in `computeMetrics`.

- [ ] **Step 4: Commit**

```bash
git add scripts/metrics-smoke.ts package.json
git commit -m "test: add computeMetrics unit checks (check:metrics)"
```

---

## Task 5: Document + final build

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add an `app/admin/page.tsx` bullet near the other app entries:
```
- **`app/admin/page.tsx`** — `/admin`, a read-only aggregate metrics dashboard
  (server component reading SQLite directly). Shows total interviews, completion
  rate, average overall + per-area scores, score-band distribution, top companies,
  and recent sessions. **No auth — publicly viewable** (an env-password gate can be
  added later).
```
Add to the Scripts section after `check:report`:
```
- `npm run check:metrics` — deterministic unit checks for the admin metrics
  aggregator (`computeMetrics`). No DB or network required.
```

- [ ] **Step 2: Final build**

Run: `npm run build`
Expected: success; `/admin` listed as a dynamic (ƒ) route.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document /admin and check:metrics"
```

---

## Done criteria

- `npx tsc --noEmit` and `npm run build` pass; `/admin` is a dynamic route.
- `npm run check:metrics` prints `ALL METRICS CHECKS PASSED`.
- `/admin` renders the metric set from `sessions`/`turns`/`reports`, with an empty
  state at zero sessions; `getMetrics` skips malformed report rows.
- No new deps; no auth (by design).
