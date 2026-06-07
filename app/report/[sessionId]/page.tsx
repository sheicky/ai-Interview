/**
 * /report/[sessionId] — renders the stored interview report (server component,
 * reads SQLite directly). No auth, session-scoped by the URL.
 */
import { getReport } from "@/lib/db";
import type { Report } from "@/lib/report";
import { DownloadButton } from "./DownloadButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "3rem 1.5rem 4rem",
  color: "var(--ink)",
};
const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  padding: "1.1rem 1.2rem",
  marginBottom: 14,
  boxShadow: "var(--shadow-sm)",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};
const eyebrow: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--btn)",
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "11px 22px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "none",
  display: "inline-block",
};
const btnGhost: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 999,
  padding: "11px 22px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "none",
  display: "inline-block",
};

function List({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={card}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 8 }}>{title}</h2>
      <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink)" }}>
        {items.map((x, i) => (
          <li key={i} style={{ marginBottom: 5, lineHeight: 1.5 }}>
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  if (!UUID_RE.test(sessionId)) {
    return (
      <main style={page}>
        <h1>Report</h1>
        <p>Invalid session.</p>
      </main>
    );
  }

  const row = await getReport(sessionId);
  if (!row) {
    return (
      <main style={page}>
        <h1>Report</h1>
        <p style={{ color: "#6b7280" }}>
          Report isn&apos;t ready yet.{" "}
          <a href={`/interview/${sessionId}`}>Back to the interview</a>
        </p>
      </main>
    );
  }

  const r = JSON.parse(row.json) as Report;
  const areas: [string, { score: number; comment: string } | null][] = [
    ["Technical", r.areas.technical],
    ["Communication", r.areas.communication],
    ["Role fit", r.areas.role_fit],
    ["Company fit", r.areas.company_fit],
  ];

  return (
    <main style={page}>
      <header style={{ marginBottom: "1.5rem" }}>
        <span style={eyebrow}>AI Interview</span>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 600, margin: "6px 0 0" }}>
          Interview report
        </h1>
      </header>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {r.overall.score}
          </span>
          <span style={{ fontSize: 16, color: "var(--muted)" }}>/ 100 · {r.overall.band}</span>
        </div>
        <p style={{ margin: "8px 0 0", lineHeight: 1.55 }}>{r.overall.verdict}</p>
      </div>

      <div style={grid}>
        {areas
          .filter(([, a]) => a != null)
          .map(([name, a]) => (
            <div key={name} style={card}>
              <div style={eyebrow}>{name}</div>
              <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em", margin: "4px 0 6px" }}>
                {a!.score}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{a!.comment}</div>
            </div>
          ))}
      </div>

      <div style={{ height: 8 }} />
      <List title="Strengths" items={r.strengths} />
      <List title="Areas to improve" items={r.gaps} />
      <List title="Notable moments" items={r.notable_moments} />
      <List title="Suggested next steps" items={r.next_steps} />

      <div className="no-print" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: "1.75rem" }}>
        <a href="/" style={btnPrimary}>
          Take another interview
        </a>
        <DownloadButton style={btnGhost} />
      </div>
    </main>
  );
}
