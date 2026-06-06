/**
 * /report/[sessionId] — renders the stored interview report (server component,
 * reads SQLite directly). No auth, session-scoped by the URL.
 */
import { getReport } from "@/lib/db";
import type { Report } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: 24,
  fontFamily: "system-ui, sans-serif",
  color: "#1a1a1a",
};
const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 16 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };

function List({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>{title}</h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((x, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
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
      <h1>Interview report</h1>

      <div style={card}>
        <div style={{ fontSize: 40, fontWeight: 800 }}>
          {r.overall.score}
          <span style={{ fontSize: 18, color: "#6b7280" }}> / 100 · {r.overall.band}</span>
        </div>
        <p style={{ marginBottom: 0 }}>{r.overall.verdict}</p>
      </div>

      <div style={grid}>
        {areas
          .filter(([, a]) => a != null)
          .map(([name, a]) => (
            <div key={name} style={card}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{name}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{a!.score}</div>
              <div style={{ fontSize: 13, color: "#374151" }}>{a!.comment}</div>
            </div>
          ))}
      </div>

      <div style={{ height: 8 }} />
      <List title="Strengths" items={r.strengths} />
      <List title="Areas to improve" items={r.gaps} />
      <List title="Notable moments" items={r.notable_moments} />
      <List title="Suggested next steps" items={r.next_steps} />
    </main>
  );
}
