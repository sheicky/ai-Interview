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
  return { id, company, company_url: null, role: null, created_at, status: "created", ended_at: null };
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
assert.equal(m.recentSessions.length, 3);
assert.equal(m.recentSessions[0].company, "Acme");
const scoreFor = (id: string) => m.recentSessions.find((s) => s.id === id)!.overallScore;
assert.equal(scoreFor("33333333-3333-4333-8333-333333333333"), null, "report-less session → null score");
assert.equal(scoreFor("11111111-1111-4111-8111-111111111111"), 90);
ok("mixed set → correct aggregates");

console.log("\nALL METRICS CHECKS PASSED");
