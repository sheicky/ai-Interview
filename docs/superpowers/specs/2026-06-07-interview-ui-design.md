# Interview UI (slice 1) — text-mode interview + report view

**Date:** 2026-06-07
**Branch:** feat/interview-ui off main
**Status:** Design — approved, pending spec review
**Builds on:** the brain (`/api/llm`, PR #6), the report (`/api/report`, PR #7), sessions/RAG. Project design doc Build Plan step 4 ("Interview screen UI"), taken as a text-first slice.

## Goal

Make the pipeline usable in the browser: after intake, the candidate does a
**text** interview with the AI on `/interview/[sessionId]`, then ends it and views
a server-rendered report at `/report/[sessionId]`. No voice yet (slice 2), no
visual polish yet (slice 3).

## Decisions (locked)

1. **Reuse the brain core.** Extract the shared turn handler from `/api/llm` into
   `lib/brain.ts`; both `/api/llm` (ElevenLabs, shared-secret) and a new
   `/api/chat` (browser, no secret) call it. No behavior change to `/api/llm`.
2. **Interviewer greets first** — on page mount the screen sends an empty-history
   turn; the brain's `sanitizeHistory` injects the kickoff so the interviewer opens.
3. **Separate `/report/[sessionId]` page** (server component reading the stored
   report), navigated to from the interview screen's "End interview" button.
4. **`/api/chat` is unauthenticated but session-scoped** (valid UUID + existing
   session), mirroring `/api/sessions` and `/api/report`. Accepted token-burn
   posture for a demo (unguessable session UUID).

## Out of scope

- ElevenLabs voice transport (slice 2), the orb + visual/motion polish (slice 3).
- Report PDF/Markdown export.
- Persisting the candidate-visible message list server-side beyond the existing
  `turns` logging (the client holds the live conversation; the brain logs the tail
  of each turn as today).
- Auth on the interview/report pages (no login, consistent with the app).

## Current state

- `app/api/llm/route.ts` — the brain, all logic inline (auth → `findSessionId`
  extra-body → UUID → `getSession` 404 → parse messages → retrieve → prompt →
  OpenRouter stream → OpenAI SSE + best-effort turn logging). GET health check.
- `lib/interviewer.ts` — `buildSystemPrompt`, `sanitizeHistory`, `latestUserText`,
  `countAssistantTurns`, `phaseForTurn`, `Msg`. `lib/sse.ts` — `sseChunk`,`SSE_DONE`.
  `lib/llm.ts` — `streamReply`. `lib/db.ts` — `getSession`, `addTurn`, `getReport`.
  `lib/report.ts` — `Report` type.
- `app/page.tsx` — intake; on success shows the session id and the placeholder note
  "(The voice interview screen wires up next.)". No `/interview` or `/report` route.

## Target architecture

### `lib/brain.ts` (new) — shared turn handler
Move the retrieve→stream→log core out of `/api/llm` verbatim (behavior-preserving):

```ts
import { retrieve } from "./rag";
import { addTurn } from "./db";
import { streamReply } from "./llm";
import { sseChunk, SSE_DONE } from "./sse";
import {
  buildSystemPrompt, sanitizeHistory, latestUserText,
  countAssistantTurns, phaseForTurn, type Msg,
} from "./interviewer";

/** Filter a request body's `messages` to well-formed {role,content} turns. */
export function parseMessages(body: unknown): Msg[] {
  const raw = Array.isArray((body as { messages?: unknown })?.messages)
    ? (body as { messages: unknown[] }).messages
    : [];
  return raw
    .filter((m): m is Msg =>
      !!m && typeof (m as Msg).role === "string" && typeof (m as Msg).content === "string")
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Run one interview turn for an already-validated, existing session: retrieve →
 * prompt → stream from OpenRouter → re-emit OpenAI SSE → log the tail. Returns a
 * streaming Response (or a JSON 502 Response on a backend failure).
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
        try { controller.close(); } catch { /* already closed/errored */ }
        try {
          if (userText) addTurn({ sessionId, role: "user", text: userText });
          if (reply) addTurn({ sessionId, role: "assistant", text: reply, phase, latencyMs: ttft ?? undefined });
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

### `app/api/llm/route.ts` (refactor — behavior unchanged)
Keeps `runtime`/`maxDuration`, the `SHARED_SECRET`/`UUID_RE`, `findSessionId`, and the
GET health check. POST becomes: auth → parse body → `findSessionId` → UUID 400 →
`getSession` 404 → `parseMessages(body)` → `return interviewTurnResponse({ sessionId,
company: session.company, messages, signal: req.signal })`. (`check:brain` must still
pass — the regression guard.)

### `app/api/chat/route.ts` (new — browser-facing)
```ts
export const runtime = "nodejs";
export const maxDuration = 60;
const UUID_RE = /.../; // same as the brain

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!UUID_RE.test(sessionId)) return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  const session = getSession(sessionId);
  if (!session) return Response.json({ error: "unknown session" }, { status: 404 });
  return interviewTurnResponse({
    sessionId, company: session.company, messages: parseMessages(body), signal: req.signal,
  });
}
```
No shared secret (the candidate's browser has none). Returns the same OpenAI SSE.

### `app/interview/[sessionId]/page.tsx` (new — client component)
- `"use client"`. Reads `sessionId` from the route param (via the `useParams` hook,
  or the page receives `params`; use the client `useParams()`).
- State: `messages: {role:"user"|"assistant"; content:string}[]` (display list),
  `streaming` (current partial assistant text), `status: "idle"|"streaming"|"ending"`,
  `input`, `error`.
- **Kickoff on mount** (guarded by a `useRef` so React strict-mode's double-invoke
  doesn't double-send): `send([])` — POST `/api/chat` with `messages: []`; the brain
  injects the kickoff and streams the opening question; append it as the first
  assistant message.
- **Send a turn:** append `{role:"user", content:input}`, then POST `/api/chat` with
  the full display `messages`; stream the assistant reply (parse OpenAI SSE: read
  `res.body` reader, split on `\n`, for each `data:` line that isn't `[DONE]`
  `JSON.parse` and append `choices[0].delta.content`); append the finished assistant
  message; clear `streaming`.
- **End interview:** `status="ending"`; POST `/api/report` `{session_id}`; on success
  `router.push(/report/${sessionId})`; on failure show an error and re-enable.
- Disable the input/send while `streaming`. Functional layout: a scrollable
  transcript (user right / interviewer left), a text input + Send, an End button.
- A shared SSE-reading helper (e.g. local `streamChat(messages, onDelta)`).

### `app/report/[sessionId]/page.tsx` (new — server component)
- `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
- `params` is async in Next 16: `export default async function ReportPage({ params }: { params: Promise<{ sessionId: string }> })` → `const { sessionId } = await params;`.
- Validate UUID; `const row = getReport(sessionId)`. If none → a "Report isn't ready
  yet." message (with a link back to the interview). Else `JSON.parse(row.json) as
  Report` and render: overall score + band + verdict; the four area scores (skip
  `company_fit` if null); strengths / gaps / notable_moments / next_steps lists.
- Functional styling consistent with `/admin`.

### `app/page.tsx` (intake hand-off)
Replace the placeholder note in the success card:
```
<div style={styles.note}>(The voice interview screen wires up next.)</div>
```
with a link to the interview:
```
<a href={`/interview/${result.id}`} style={styles.link}>Start interview →</a>
```
(Add a `link` style. No other change to intake.)

## Error handling

- `/api/chat`: 400 invalid JSON / bad UUID; 404 unknown session; 502 on
  retrieval/model failure (from `interviewTurnResponse`). Mid-stream errors close
  the SSE gracefully (turn logging still runs) — inherited from the brain core.
- Interview page: a failed `/api/chat` (non-2xx or network) shows an inline error
  and re-enables input; a failed `/api/report` keeps the user on the page with an
  error. Empty input is not sendable.
- Report page: missing report → friendly message, not a crash.

## Verification

1. **`npm run check:brain`** — re-run after the refactor; must still pass (proves
   `/api/llm` behavior is unchanged). Live (OpenRouter + Pinecone).
2. **`scripts/chat-smoke.ts`** (`npm run check:chat`) — live: seed a session + docs,
   POST `/api/chat` (no secret) with `messages:[{role:"user",content:"Hi"}]` → assert
   a non-empty streamed reply; POST with an unknown UUID → 404; POST with a bad
   `session_id` → 400. (Reuses the SSE-reading approach from the brain smoke.)
3. `npx tsc --noEmit` + `npm run build` — type-checks both new pages; confirm
   `/interview/[sessionId]` and `/report/[sessionId]` appear as routes (the
   interview page client, the report page dynamic ƒ).
4. **Manual dogfood (follow-up, not a gate):** `npm run dev`, submit intake, follow
   "Start interview →", do a couple of turns, End, view the report. Can run `/qa`
   later.

## Risks / notes

- **Brain refactor is the main risk** — it must be behavior-preserving so
  ElevenLabs keeps working. Mitigation: move the code verbatim and re-run
  `check:brain`.
- **React strict-mode double-mount** would double-fire the kickoff; guard with a
  ref so only one kickoff request goes out.
- **Token burn / no auth on `/api/chat`** — accepted, same posture as `/api/report`.
- **maxDuration 60** on `/api/chat` — a single non-streamed turn is well within it
  (streaming starts fast); fine.
