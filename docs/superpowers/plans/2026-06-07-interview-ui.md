# Interview UI (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser text-mode interview: extract the brain core, add a browser-facing `/api/chat`, an `/interview/[sessionId]` chat screen, and a `/report/[sessionId]` view; intake links into it.

**Architecture:** `lib/brain.ts` holds the shared turn handler (retrieve → prompt → OpenRouter SSE → log). `/api/llm` (ElevenLabs, secret) and `/api/chat` (browser, session-scoped) both delegate to it. A client interview page streams `/api/chat`; a server report page renders the stored report.

**Tech Stack:** Next.js 16 (app router, server + client components), TypeScript, `openai` (OpenRouter), `better-sqlite3`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-07-interview-ui-design.md`

---

## File Structure

- **Create** `lib/brain.ts` — `parseMessages`, `interviewTurnResponse` (moved verbatim from `/api/llm`).
- **Modify** `app/api/llm/route.ts` — thin wrapper (auth + extra-body session_id → brain).
- **Create** `app/api/chat/route.ts` — browser-facing turn endpoint (no secret).
- **Create** `app/interview/[sessionId]/page.tsx` — client chat screen.
- **Create** `app/report/[sessionId]/page.tsx` — server report view.
- **Modify** `app/page.tsx` — "Start interview →" link on success.
- **Create** `scripts/chat-smoke.ts` + **modify** `package.json` — `check:chat`.
- **Modify** `README.md` — document the screens + `check:chat`.

---

## Task 1: Extract `lib/brain.ts` and slim `/api/llm`

**Files:**
- Create: `lib/brain.ts`
- Modify: `app/api/llm/route.ts`

- [ ] **Step 1: Create `lib/brain.ts`**

```ts
/**
 * Shared interview-turn handler. Both /api/llm (ElevenLabs, shared-secret) and
 * /api/chat (browser, session-scoped) delegate here: retrieve → build prompt →
 * stream from OpenRouter → re-emit OpenAI SSE → log the tail of the turn.
 */
import { retrieve } from "./rag";
import { addTurn } from "./db";
import { streamReply } from "./llm";
import { sseChunk, SSE_DONE } from "./sse";
import {
  buildSystemPrompt,
  sanitizeHistory,
  latestUserText,
  countAssistantTurns,
  phaseForTurn,
  type Msg,
} from "./interviewer";

/** Filter a request body's `messages` to well-formed {role,content} turns. */
export function parseMessages(body: unknown): Msg[] {
  const raw = Array.isArray((body as { messages?: unknown })?.messages)
    ? (body as { messages: unknown[] }).messages
    : [];
  return raw
    .filter(
      (m): m is Msg =>
        !!m &&
        typeof (m as Msg).role === "string" &&
        typeof (m as Msg).content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Run one interview turn for an already-validated, existing session. Returns a
 * streaming OpenAI-SSE Response, or a JSON 502 Response on a backend failure.
 */
export async function interviewTurnResponse(opts: {
  sessionId: string;
  company: string;
  messages: Msg[];
  signal?: AbortSignal;
}): Promise<Response> {
  const { sessionId, company, messages, signal } = opts;

  const userText = latestUserText(messages);
  const query = userText || "candidate background, experience, and the role requirements";
  let docs: { kind: string; text: string }[];
  try {
    docs = await retrieve(query, sessionId);
  } catch (err) {
    console.error("[brain] retrieval failed:", err);
    return Response.json({ error: "retrieval failed" }, { status: 502 });
  }

  const system = buildSystemPrompt({ company, docs });
  const convo: Msg[] = [{ role: "system", content: system }, ...sanitizeHistory(messages)];
  const phase = phaseForTurn(countAssistantTurns(messages));

  const t0 = performance.now();
  let stream;
  try {
    stream = await streamReply(convo, signal);
  } catch (err) {
    console.error("[brain] OpenRouter error:", err);
    return Response.json({ error: "model backend error" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let reply = "";
  let ttft: number | null = null;

  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk("", { role: "assistant" })));
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            if (ttft === null) ttft = Math.round(performance.now() - t0);
            reply += delta;
            controller.enqueue(encoder.encode(sseChunk(delta)));
          }
        }
        controller.enqueue(encoder.encode(sseChunk("", { finish: "stop" })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        console.error("[brain] stream error:", err);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed or errored */
        }
        try {
          if (userText) addTurn({ sessionId, role: "user", text: userText });
          if (reply) {
            addTurn({ sessionId, role: "assistant", text: reply, phase, latencyMs: ttft ?? undefined });
          }
        } catch (logErr) {
          console.error("[brain] turn logging failed:", logErr);
        }
      }
    },
  });

  return new Response(out, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
```

- [ ] **Step 2: Replace `app/api/llm/route.ts` with the thin wrapper**

```ts
/**
 * POST /api/llm — the ElevenLabs front door to the interview brain.
 * Verifies the shared secret and resolves session_id from the ElevenLabs
 * extra-body, then delegates the turn to lib/brain. GET is a health check.
 */
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/db";
import { interviewTurnResponse, parseMessages } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 60;

const SHARED_SECRET = process.env.SHARED_SECRET ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Look for session_id wherever ElevenLabs might place it (mirrors the spike). */
function findSessionId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.session_id === "string") return b.session_id;
  const extra = b.elevenlabs_extra_body;
  if (extra && typeof extra === "object") {
    const sid = (extra as Record<string, unknown>).session_id;
    if (typeof sid === "string") return sid;
  }
  if (typeof b.system__session_id === "string") return b.system__session_id;
  return null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const secret = req.headers.get("x-shared-secret") ?? "";
  if (!SHARED_SECRET || secret !== SHARED_SECRET) {
    return Response.json({ error: "bad or missing X-Shared-Secret" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const sessionId = findSessionId(body);
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  return interviewTurnResponse({
    sessionId,
    company: session.company,
    messages: parseMessages(body),
    signal: req.signal,
  });
}

export function GET(): Response {
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed; `/api/llm` still listed.

- [ ] **Step 4: Regression — re-run the brain smoke**

Run: `npm run check:brain`
Expected: `ALL BRAIN SMOKE CHECKS PASSED` (proves the refactor preserved `/api/llm` behavior — real OpenRouter + Pinecone). If it fails, the extraction diverged from the original; fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/brain.ts app/api/llm/route.ts
git commit -m "refactor: extract interview-turn handler into lib/brain"
```

---

## Task 2: Add `/api/chat` + live smoke

**Files:**
- Create: `app/api/chat/route.ts`
- Create: `scripts/chat-smoke.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `app/api/chat/route.ts`**

```ts
/**
 * POST /api/chat — browser-facing interview turn. Session-scoped (valid UUID +
 * existing session), no shared secret (mirrors /api/sessions, /api/report).
 * Returns the same OpenAI SSE the ElevenLabs path uses; the client parses it.
 */
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/db";
import { interviewTurnResponse, parseMessages } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { session_id?: unknown } | null;
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });

  return interviewTurnResponse({
    sessionId,
    company: session.company,
    messages: parseMessages(body),
    signal: req.signal,
  });
}
```

- [ ] **Step 2: Write `scripts/chat-smoke.ts`**

```ts
/**
 * Real round-trip for the browser chat endpoint. Run:
 *   npm run check:chat
 * Requires OPENROUTER_API_KEY, OPENROUTER_MODEL, PINECONE_API_KEY, PINECONE_INDEX.
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { NextRequest } from "next/server";
import { createSession, deleteSession } from "../lib/db";
import { addSessionDocs, deleteSessionDocs } from "../lib/rag";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

function chatReq(payload: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function readSse(res: Response): Promise<string> {
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      out += JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function main() {
  const { POST } = await import("../app/api/chat/route");

  // bad UUID → 400
  assert.equal((await POST(chatReq({ session_id: "nope", messages: [] }))).status, 400);
  ok("bad session_id → 400");

  // unknown (valid UUID, no session) → 404
  assert.equal((await POST(chatReq({ session_id: randomUUID(), messages: [] }))).status, 404);
  ok("unknown session → 404");

  const sid = randomUUID();
  try {
    createSession({ id: sid, company: "Acme Corp" });
    await addSessionDocs(sid, [
      { kind: "cv", text: "Jane Doe led the billing rewrite at Acme; 8 years backend." },
      { kind: "jd", text: "Senior backend engineer for the billing platform." },
    ]);

    const res = await POST(chatReq({ session_id: sid, messages: [{ role: "user", content: "Hi, I'm ready." }] }));
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const reply = await readSse(res);
    assert.ok(reply.trim().length > 0, "interviewer reply must be non-empty");
    ok("POST /api/chat streams a non-empty interviewer turn");
    console.log(`  reply: ${reply.slice(0, 160)}${reply.length > 160 ? "…" : ""}`);

    console.log("\nALL CHAT SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sid).catch(() => {});
    try {
      deleteSession(sid);
    } catch {
      /* best-effort */
    }
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the `check:chat` npm script**

In `package.json` `"scripts"`, add after `check:metrics`:
```json
    "check:metrics": "node --import tsx scripts/metrics-smoke.ts",
    "check:chat": "node --env-file=.env --import tsx scripts/chat-smoke.ts"
```
(Keep the comma after the `check:metrics` line.)

- [ ] **Step 4: Typecheck, build, run smoke**

Run: `npx tsc --noEmit && npm run build`
Expected: success; `/api/chat` appears as a route.
Run: `npm run check:chat`
Expected: `ALL CHAT SMOKE CHECKS PASSED`. Real OpenRouter + Pinecone. Do NOT weaken assertions.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts scripts/chat-smoke.ts package.json
git commit -m "feat: add browser-facing /api/chat + live smoke"
```

---

## Task 3: Interview screen `app/interview/[sessionId]/page.tsx`

**Files:**
- Create: `app/interview/[sessionId]/page.tsx`

- [ ] **Step 1: Write the client chat screen**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Msg {
  role: "user" | "assistant";
  content: string;
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
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
            if (delta) {
              acc += delta;
              setStreaming(acc);
            }
          } catch {
            /* ignore keepalive / non-JSON lines */
          }
        }
      }
      setMessages((m) => [...m, { role: "assistant", content: acc }]);
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
      </div>

      {error && <p role="alert" style={s.error}>{error}</p>}

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
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success; `/interview/[sessionId]` appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add app/interview
git commit -m "feat: text-mode interview screen (/interview/[sessionId])"
```

---

## Task 4: Report view + intake hand-off

**Files:**
- Create: `app/report/[sessionId]/page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Write the report page (server component)**

```tsx
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
          <li key={i} style={{ marginBottom: 4 }}>{x}</li>
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

  const row = getReport(sessionId);
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
```

- [ ] **Step 2: Add the "Start interview" link in `app/page.tsx`**

Find the success-card note:
```tsx
            <div style={styles.note}>(The voice interview screen wires up next.)</div>
```
Replace with a link to the interview:
```tsx
            <div style={styles.note}>
              <a href={`/interview/${result.id}`}>Start interview →</a>
            </div>
```
(The existing `styles.note` is fine; no new style needed.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success; `/report/[sessionId]` appears as a dynamic (ƒ) route.

- [ ] **Step 4: Commit**

```bash
git add app/report app/page.tsx
git commit -m "feat: report view page + intake link into the interview"
```

---

## Task 5: Document + final build

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add bullets near the other app entries:
```
- **`app/interview/[sessionId]/page.tsx`** — the text-mode interview screen
  (client). The interviewer greets first, then streams replies from `/api/chat`;
  "End interview" generates the report and navigates to `/report/[sessionId]`.
- **`app/report/[sessionId]/page.tsx`** — server-rendered view of the stored
  report (overall + area scores, strengths/gaps/next steps).
- **`app/api/chat/route.ts`** — browser-facing turn endpoint. Session-scoped, no
  shared secret; shares the brain core (`lib/brain.ts`) with `/api/llm` and returns
  the same OpenAI SSE.
```
Add to the Scripts section after `check:metrics`:
```
- `npm run check:chat` — real round-trip for `/api/chat` (`scripts/chat-smoke.ts`):
  seeds a session, asserts a streamed reply plus 400/404 guards. Requires
  `OPENROUTER_*` and `PINECONE_*` in `.env`.
```
If the README has a flow/overview that says the interview screen is pending, update it to note the text interview is live (voice is a later slice).

- [ ] **Step 2: Final build**

Run: `npm run build`
Expected: success; routes include `/interview/[sessionId]` and `/report/[sessionId]`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the interview + report screens and check:chat"
```

---

## Done criteria

- `npx tsc --noEmit` and `npm run build` pass; `/api/chat`, `/interview/[sessionId]`, `/report/[sessionId]` all present.
- `npm run check:brain` still passes (refactor preserved `/api/llm`).
- `npm run check:chat` prints `ALL CHAT SMOKE CHECKS PASSED`.
- Intake links to `/interview/[id]`; the interview streams turns and "End" routes to the rendered report.
- No new deps.
