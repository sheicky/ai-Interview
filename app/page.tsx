"use client";

import { useState, type FormEvent } from "react";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; scraped: boolean } | null>(null);
  const [cvName, setCvName] = useState<string | null>(null);

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
      <div style={styles.shell}>
        <header style={styles.head}>
          <span style={styles.brand}>
            <span style={styles.dot} aria-hidden /> AI Interview
          </span>
          <h1 style={styles.h1}>Practice the real interview.</h1>
          <p style={styles.sub}>
            Add your CV and the job. A voice interviewer asks role-specific questions,
            digs into your background, and hands you a scored report at the end.
          </p>
        </header>

        <div style={styles.card}>
        <form onSubmit={onSubmit} style={styles.form}>
          <label style={styles.label}>
            Your CV (PDF)
            <span style={styles.fileRow}>
              <span style={styles.fileBtn}>Choose PDF</span>
              <span style={cvName ? styles.fileName : styles.filePlaceholder}>
                {cvName ?? "No file selected"}
              </span>
              <input
                name="cv"
                type="file"
                accept="application/pdf"
                required
                onChange={(e) => setCvName(e.target.files?.[0]?.name ?? null)}
                style={styles.fileNative}
              />
            </span>
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
            <label style={{ ...styles.label, flex: 1, minWidth: 180 }}>
              Role
              <input name="role" type="text" required placeholder="Senior Backend Engineer" style={styles.input} />
            </label>
            <label style={{ ...styles.label, flex: 1, minWidth: 180 }}>
              Company
              <input name="company" type="text" required placeholder="Acme Inc." style={styles.input} />
            </label>
          </div>

          <label style={styles.label}>
            Company website (optional)
            <input name="companyUrl" type="url" placeholder="https://acme.com" style={styles.input} />
          </label>

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
            <strong>You&apos;re all set.</strong> Your interview is prepared
            {result.scraped ? " and the company page is indexed." : "."}
            <a href={`/interview/${result.id}`} style={styles.okLink}>
              Start interview →
            </a>
          </div>
        )}
        </div>
        <p style={styles.foot}>Spoken interview · ~10 minutes · works best in a quiet room</p>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    padding: "48px 24px",
    background: "var(--hero)",
    color: "var(--ink)",
  },
  shell: { width: "100%", maxWidth: 540, minWidth: 0 },
  head: { textAlign: "center", marginBottom: 24 },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--muted)",
    marginBottom: 18,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 0 4px var(--accent-soft)",
  },
  h1: {
    fontSize: 38,
    lineHeight: 1.05,
    letterSpacing: "-0.02em",
    fontWeight: 600,
    margin: "0 0 12px",
  },
  sub: {
    color: "var(--muted)",
    fontSize: 16,
    lineHeight: 1.55,
    margin: "0 auto",
    maxWidth: 440,
  },
  card: {
    width: "100%",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-lg)",
    padding: 28,
    boxShadow: "var(--shadow)",
  },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ink)",
  },
  row: { display: "flex", gap: 14, flexWrap: "wrap" },
  input: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    fontSize: 15,
    fontWeight: 400,
    padding: "11px 13px",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-sm)",
    fontFamily: "inherit",
    background: "#fcfcfb",
    color: "var(--ink)",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  fileRow: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 8,
    border: "1px solid var(--line)",
    borderRadius: "var(--radius-sm)",
    background: "#fcfcfb",
    cursor: "pointer",
  },
  fileBtn: {
    flexShrink: 0,
    background: "var(--bg-tint)",
    border: "1px solid var(--line)",
    borderRadius: 999,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ink)",
    whiteSpace: "nowrap",
  },
  fileName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 400,
    color: "var(--ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  filePlaceholder: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 400,
    color: "var(--muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileNative: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: "pointer",
  },
  button: {
    marginTop: 4,
    background: "var(--btn)",
    color: "#fff",
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    padding: "14px 20px",
    borderRadius: 999,
    cursor: "pointer",
    transition: "background 0.15s ease, transform 0.05s ease",
  },
  error: {
    color: "var(--danger)",
    fontSize: 14,
    marginTop: 16,
    background: "#fbeeee",
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
  },
  ok: {
    background: "var(--ok-soft)",
    border: "1px solid #d8e8d8",
    borderRadius: "var(--radius)",
    padding: 16,
    marginTop: 16,
    fontSize: 14,
    lineHeight: 1.5,
  },
  okLink: { display: "inline-block", marginTop: 8, fontWeight: 600 },
  foot: {
    textAlign: "center",
    color: "var(--muted)",
    fontSize: 13,
    marginTop: 18,
  },
};
