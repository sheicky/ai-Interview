"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** Extract delta content from one OpenAI-SSE `data:` line ("" if not a content line). */
function parseSseLine(line: string): string {
  if (!line.startsWith("data: ")) return "";
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return "";
  try {
    return JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

export default function InterviewPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "ending">("idle");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kicked = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  /** POST the conversation to /api/chat and stream the assistant reply. */
  async function streamChat(outgoing: Msg[]) {
    setStatus("streaming");
    setStreaming("");
    setError(null);
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, messages: outgoing }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Something went wrong (${res.status}).`);
        setStatus("idle");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          acc += parseSseLine(line);
        }
        setStreaming(acc);
      }
      buf += decoder.decode(); // flush any trailing multi-byte char
      acc += parseSseLine(buf);
      if (acc) setMessages((m) => [...m, { role: "assistant", content: acc }]);
      setStreaming("");
      setStatus("idle");
    } catch {
      setError("Network error — is the server running?");
      setStatus("idle");
    }
  }

  // Interviewer greets first: one kickoff with empty history (ref-guarded so
  // React strict-mode's double-mount doesn't double-send).
  useEffect(() => {
    if (kicked.current) return;
    kicked.current = true;
    void streamChat([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSend() {
    const text = input.trim();
    if (!text || status !== "idle") return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    await streamChat(next);
  }

  async function onEnd() {
    if (status !== "idle") return;
    setStatus("ending");
    setError(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Could not generate report (${res.status}).`);
        setStatus("idle");
        return;
      }
      router.push(`/report/${sessionId}`);
    } catch {
      setError("Network error generating the report.");
      setStatus("idle");
    }
  }

  return (
    <main style={s.main}>
      <div style={s.head}>
        <h1 style={s.h1}>Interview</h1>
        <button onClick={onEnd} disabled={status !== "idle"} style={s.endBtn}>
          {status === "ending" ? "Generating report…" : "End interview"}
        </button>
      </div>

      <div style={s.transcript}>
        {messages.map((m, i) => (
          <div key={i} style={m.role === "user" ? s.userRow : s.aiRow}>
            <span style={m.role === "user" ? s.userBubble : s.aiBubble}>{m.content}</span>
          </div>
        ))}
        {streaming && (
          <div style={s.aiRow}>
            <span style={s.aiBubble}>{streaming}</span>
          </div>
        )}
        {status === "streaming" && !streaming && <p style={s.thinking}>…</p>}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" style={s.error}>
          {error}
        </p>
      )}

      <form
        style={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your answer…"
          disabled={status !== "idle"}
          style={s.input}
        />
        <button type="submit" disabled={status !== "idle" || !input.trim()} style={s.sendBtn}>
          Send
        </button>
      </form>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  main: { maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1a1a1a", display: "flex", flexDirection: "column", minHeight: "100vh" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 22, margin: 0 },
  endBtn: { background: "#ef4444", color: "#fff", border: "none", borderRadius: 999, padding: "8px 16px", fontWeight: 600, cursor: "pointer" },
  transcript: { flex: 1, display: "flex", flexDirection: "column", gap: 10, margin: "16px 0", overflowY: "auto" },
  userRow: { display: "flex", justifyContent: "flex-end" },
  aiRow: { display: "flex", justifyContent: "flex-start" },
  userBubble: { background: "#2563eb", color: "#fff", borderRadius: 14, padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap" },
  aiBubble: { background: "#f1f5f9", color: "#1a1a1a", borderRadius: 14, padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap" },
  thinking: { color: "#94a3b8" },
  error: { color: "#dc2626", fontSize: 14 },
  form: { display: "flex", gap: 8, position: "sticky", bottom: 0, background: "#fff", paddingTop: 8 },
  input: { flex: 1, fontSize: 15, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10, fontFamily: "inherit" },
  sendBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 600, cursor: "pointer" },
};
