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
