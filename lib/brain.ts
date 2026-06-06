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
