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

/**
 * Pure aggregator over already-fetched rows.
 * `sessions` must be ordered newest-first — `recentSessions` takes the first 10
 * as-is (getMetrics passes them ORDER BY created_at DESC).
 */
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
    completionRate: totalInterviews > 0 ? Math.min(1, reportsCount / totalInterviews) : 0,
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
export async function getMetrics(): Promise<Metrics> {
  const reports: { session_id: string; report: Report }[] = [];
  for (const row of await getAllReports()) {
    try {
      reports.push({ session_id: row.session_id, report: JSON.parse(row.json) as Report });
    } catch (err) {
      console.error("[metrics] skipping malformed report for", row.session_id, err);
    }
  }
  return computeMetrics({
    sessions: await getAllSessions(),
    reports,
    candidateTurnCounts: await getCandidateTurnCounts(),
  });
}
