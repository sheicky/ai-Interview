"use client";

import { useState, type FormEvent } from "react";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; scraped: boolean } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      // The server may return a non-JSON body on an unexpected failure
      // (framework 500, gateway error) — don't let res.json() throw.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Something went wrong (${res.status}).`);
        return;
      }
      setResult({ id: data.session_id, scraped: data.company_scraped });
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.main}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Practice your interview</h1>
        <p style={styles.sub}>
          Drop in your CV and the job, and an AI interviewer will talk you through a
          real, role-specific interview — then hand you a report.
        </p>

        <form onSubmit={onSubmit} style={styles.form}>
          <label style={styles.label}>
            Your CV (PDF)
            <input name="cv" type="file" accept="application/pdf" required style={styles.input} />
          </label>

          <label style={styles.label}>
            Job description
            <textarea
              name="jd"
              required
              rows={6}
              placeholder="Paste the full job description here…"
              style={{ ...styles.input, resize: "vertical" }}
            />
          </label>

          <div style={styles.row}>
            <label style={{ ...styles.label, flex: 1 }}>
              Company
              <input name="company" type="text" required placeholder="Acme Inc." style={styles.input} />
            </label>
            <label style={{ ...styles.label, flex: 1 }}>
              Company website (optional)
              <input name="companyUrl" type="url" placeholder="https://acme.com" style={styles.input} />
            </label>
          </div>

          <button
            type="submit"
            disabled={busy}
            style={{
              ...styles.button,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Preparing your interview…" : "Start interview"}
          </button>
        </form>

        {error && (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        )}
        {result && (
          <div style={styles.ok}>
            <strong>Session ready.</strong> id <code>{result.id}</code>
            {result.scraped ? " · company page indexed" : " · company name only"}
            <div style={styles.note}>(The voice interview screen wires up next.)</div>
          </div>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#fafafa",
    color: "#1a1a1a",
  },
  card: {
    width: "100%",
    maxWidth: 560,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 20,
    padding: 32,
  },
  h1: { fontSize: 26, margin: "0 0 6px" },
  sub: { color: "#6b7280", fontSize: 15, lineHeight: 1.5, margin: "0 0 24px" },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600 },
  row: { display: "flex", gap: 16, flexWrap: "wrap" },
  input: {
    fontSize: 15,
    fontWeight: 400,
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    fontFamily: "inherit",
  },
  button: {
    marginTop: 8,
    background: "#2563eb",
    color: "#fff",
    border: "none",
    fontSize: 16,
    fontWeight: 600,
    padding: "14px 20px",
    borderRadius: 999,
    cursor: "pointer",
  },
  error: { color: "#dc2626", fontSize: 14, marginTop: 16 },
  ok: { background: "#eef2ff", borderRadius: 12, padding: 16, marginTop: 16, fontSize: 14 },
  note: { color: "#6b7280", marginTop: 6, fontSize: 13 },
};
