/**
 * /admin — read-only aggregate metrics dashboard. Server component; reads SQLite
 * directly on each request. Gated by a code (ADMIN_CODE) held in an httpOnly
 * cookie — metrics are never rendered until the cookie matches.
 */
import { cookies } from "next/headers";
import { getMetrics } from "@/lib/metrics";
import { login } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_CODE = process.env.ADMIN_CODE ?? "";
const ADMIN_COOKIE = "admin_auth"; // keep in sync with app/admin/actions.ts

const page: React.CSSProperties = {
  maxWidth: 920,
  margin: "0 auto",
  padding: "3rem 1.5rem 4rem",
  color: "var(--ink)",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 14,
  margin: "0.75rem 0 2.25rem",
};
const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  padding: "1.1rem 1.2rem",
  boxShadow: "var(--shadow-sm)",
};
const big: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 600,
  letterSpacing: "-0.02em",
  margin: 0,
};
const label: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--muted)",
  margin: "0 0 0.4rem",
};
const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--line)",
  padding: "0.6rem 0.5rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
const td: React.CSSProperties = { borderBottom: "1px solid var(--line)", padding: "0.6rem 0.5rem", fontSize: 14 };
const h2: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: "0.01em",
  margin: "0 0 0.25rem",
};

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

const gateWrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--ink)",
  padding: "2rem",
  background:
    "radial-gradient(120% 80% at 50% -10%, var(--accent-soft) 0%, var(--bg) 46%)",
};
const gateCard: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow)",
  padding: "1.75rem",
};
const gateForm: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.85rem",
  width: "100%",
  maxWidth: 300,
  textAlign: "center",
};
const gateInput: React.CSSProperties = {
  padding: "0.8rem 0.9rem",
  fontSize: "1.1rem",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  textAlign: "center",
  letterSpacing: "0.35em",
  background: "#fcfcfb",
  color: "var(--ink)",
};
const gateBtn: React.CSSProperties = {
  padding: "0.8rem 0.9rem",
  fontSize: "1rem",
  fontWeight: 600,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
};

function Gate({ error }: { error: boolean }) {
  return (
    <main style={gateWrap}>
      <div style={gateCard}>
      <form action={login} style={gateForm}>
        <h1 style={{ fontSize: "1.3rem", letterSpacing: "-0.01em", margin: 0 }}>Admin access</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 0.25rem" }}>
          Enter the access code to view metrics.
        </p>
        <input
          style={gateInput}
          type="password"
          name="code"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          placeholder="Access code"
          aria-label="Access code"
        />
        <button style={gateBtn} type="submit">
          Unlock
        </button>
        {error && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: "0.85rem", margin: 0 }}>
            Incorrect code. Try again.
          </p>
        )}
      </form>
      </div>
    </main>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const authed = ADMIN_CODE !== "" && (await cookies()).get(ADMIN_COOKIE)?.value === ADMIN_CODE;
  if (!authed) {
    const { error } = await searchParams;
    return <Gate error={error === "1"} />;
  }

  const m = await getMetrics();

  if (m.totalInterviews === 0) {
    return (
      <main style={page}>
        <header style={{ marginBottom: "1.5rem" }}>
          <span style={{ ...label, display: "block", marginBottom: 6 }}>AI Interview</span>
          <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 600, margin: 0 }}>
            Metrics
          </h1>
        </header>
        <div style={{ ...card, color: "var(--muted)" }}>
          No interviews yet. Numbers will appear here once candidates complete interviews.
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <header style={{ marginBottom: "1.75rem" }}>
        <span style={{ ...label, display: "block", marginBottom: 6 }}>AI Interview</span>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 600, margin: 0 }}>
          Metrics
        </h1>
      </header>

      <section style={grid}>
        <Stat title="Total interviews" value={String(m.totalInterviews)} />
        <Stat title="Completion rate" value={`${Math.round(m.completionRate * 100)}%`} />
        <Stat title="Avg overall score" value={score(m.avgOverallScore)} />
        <Stat title="Avg candidate turns" value={score(m.avgCandidateTurns)} />
      </section>

      <h2 style={h2}>Score bands</h2>
      <section style={grid}>
        <Stat title="Strong" value={String(m.bandDistribution.strong)} />
        <Stat title="Mixed" value={String(m.bandDistribution.mixed)} />
        <Stat title="Weak" value={String(m.bandDistribution.weak)} />
      </section>

      <h2 style={h2}>Average area scores</h2>
      <section style={grid}>
        <Stat title="Technical" value={score(m.avgAreaScores.technical)} />
        <Stat title="Communication" value={score(m.avgAreaScores.communication)} />
        <Stat title="Role fit" value={score(m.avgAreaScores.role_fit)} />
        <Stat title="Company fit" value={score(m.avgAreaScores.company_fit)} />
      </section>

      <h2 style={h2}>Top companies</h2>
      {m.topCompanies.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>None.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: 8, margin: "0.25rem 0 0" }}>
          {m.topCompanies.map((c) => (
            <li
              key={c.company}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 13,
              }}
            >
              {c.company} <span style={{ color: "var(--muted)" }}>· {c.count}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ ...h2, marginTop: "2rem" }}>Recent sessions</h2>
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
