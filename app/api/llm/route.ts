/**
 * POST /api/llm — the interview brain (OpenAI-compatible, for ElevenLabs).
 *
 *   1. verify the shared secret (webhook auth)
 *   2. resolve session_id (ElevenLabs extra-body) and validate it's a UUID
 *   3. retrieve the session's CV/JD/company docs from Pinecone
 *   4. build the interviewer system prompt (untrusted-context wrapped)
 *   5. stream the reply from OpenRouter, re-emitting OpenAI SSE chunks
 *   6. log the newest user turn + the assistant reply (best-effort)
 *
 * ElevenLabs resends the full message history each turn, so we only log the tail.
 */
import type { NextRequest } from "next/server";
import { retrieve } from "@/lib/rag";
import { getSession, addTurn } from "@/lib/db";
import { streamReply } from "@/lib/llm";
import { sseChunk, SSE_DONE } from "@/lib/sse";
import {
  buildSystemPrompt,
  sanitizeHistory,
  latestUserText,
  countAssistantTurns,
  phaseForTurn,
  type Msg,
} from "@/lib/interviewer";

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
  // 1. Webhook auth.
  const secret = req.headers.get("x-shared-secret") ?? "";
  if (!SHARED_SECRET || secret !== SHARED_SECRET) {
    return Response.json({ error: "bad or missing X-Shared-Secret" }, { status: 401 });
  }

  // 2. Parse + resolve session.
  const body: unknown = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });

  const sessionId = findSessionId(body);
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return Response.json({ error: "missing or invalid session_id" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return Response.json({ error: "unknown session" }, { status: 404 });
  }

  const rawMessages = Array.isArray((body as { messages?: unknown }).messages)
    ? ((body as { messages: unknown[] }).messages)
    : [];
  const messages: Msg[] = rawMessages
    .filter(
      (m): m is Msg =>
        !!m &&
        typeof (m as Msg).role === "string" &&
        typeof (m as Msg).content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));

  // 3. Retrieve (Pinecone, scoped to this session's namespace).
  const userText = latestUserText(messages);
  const query = userText || "candidate background, experience, and the role requirements";
  let docs: { kind: string; text: string }[];
  try {
    docs = await retrieve(query, sessionId);
  } catch (err) {
    console.error("[/llm] retrieval failed:", err);
    return Response.json({ error: "retrieval failed" }, { status: 502 });
  }

  // 4. Build the prompt.
  const company = session.company;
  const system = buildSystemPrompt({ company, docs });
  const convo: Msg[] = [{ role: "system", content: system }, ...sanitizeHistory(messages)];
  // Phase tracks assistant turns already in the history — relies on ElevenLabs
  // resending the full conversation each request (it does).
  const phase = phaseForTurn(countAssistantTurns(messages));

  // 5. Stream from OpenRouter.
  const t0 = performance.now();
  let stream;
  try {
    stream = await streamReply(convo, req.signal);
  } catch (err) {
    console.error("[/llm] OpenRouter error:", err);
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
        console.error("[/llm] stream error:", err);
      } finally {
        // The controller may already be errored (client abort / failed enqueue),
        // in which case close() throws — swallow it so logging still runs.
        try {
          controller.close();
        } catch {
          /* already closed or errored */
        }
        // 6. Best-effort transcript logging — never break the response.
        try {
          if (userText) addTurn({ sessionId, role: "user", text: userText });
          if (reply) {
            addTurn({
              sessionId,
              role: "assistant",
              text: reply,
              phase,
              latencyMs: ttft ?? undefined,
            });
          }
        } catch (logErr) {
          console.error("[/llm] turn logging failed:", logErr);
        }
      }
    },
  });

  return new Response(out, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export function GET(): Response {
  return Response.json({ ok: true });
}
