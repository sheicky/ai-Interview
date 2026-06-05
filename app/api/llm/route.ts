/**
 * T1 Day-0 spike: echo /llm route.
 *
 * Purpose (design doc, Next Steps step 0): prove the ElevenLabs custom-LLM
 * binding BEFORE building the real brain. This route:
 *   1. Enforces a shared secret (the webhook-auth decision from eng review).
 *   2. Logs the RAW request body so we can SEE where ElevenLabs puts
 *      conversation_id (it is NOT in the chat/completions body by default — it
 *      must be mapped in via the agent's "Custom LLM extra body" config).
 *   3. Streams a canned reply in OpenAI chat/completions SSE format, confirming
 *      a streamed response reaches ElevenLabs TTS within the latency budget.
 *
 *   ElevenLabs ──POST /api/llm (OpenAI chat/completions)──▶ this route
 *         ▲                                                    │
 *         └──────────────── SSE stream (canned) ◀──────────────┘
 *
 * Run:  npm run dev   then expose :3000 with `ngrok http 3000` and point the
 *       ElevenLabs agent's Custom LLM at  https://<url>/api/llm
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const SHARED_SECRET = process.env.SHARED_SECRET ?? "";

/** Look for conversation_id wherever ElevenLabs might place it. */
function findConversationId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.conversation_id === "string") return b.conversation_id;
  const extra = b.elevenlabs_extra_body;
  if (extra && typeof extra === "object") {
    const cid = (extra as Record<string, unknown>).conversation_id;
    if (typeof cid === "string") return cid;
  }
  if (typeof b.system__conversation_id === "string") return b.system__conversation_id;
  return null;
}

/** One OpenAI chat/completions streaming chunk as an SSE `data:` line. */
function sseChunk(
  content: string,
  opts: { role?: string; finish?: string | null } = {},
): string {
  const delta: Record<string, string> = {};
  if (opts.role) delta.role = opts.role;
  if (content) delta.content = content;
  const payload = {
    id: "spike-0",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "spike-echo",
    choices: [{ index: 0, delta, finish_reason: opts.finish ?? null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Webhook auth (eng review decision #1).
  const secret = req.headers.get("x-shared-secret") ?? "";
  if (!SHARED_SECRET || secret !== SHARED_SECRET) {
    return Response.json({ error: "bad or missing X-Shared-Secret" }, { status: 401 });
  }

  // 2. Log the raw body — the whole point of the spike.
  const body: unknown = await req.json().catch(() => ({}));
  const convId = findConversationId(body);
  console.log("=".repeat(60));
  console.log("[/llm] conversation_id =", convId ?? "*** NOT FOUND — fix extra-body config ***");
  console.log("[/llm] raw body:", JSON.stringify(body).slice(0, 4000));
  console.log("=".repeat(60));

  // 3. Stream a canned reply in OpenAI SSE format.
  const reply = "This is the spike backend. I heard you, and the streaming path works.";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseChunk("", { role: "assistant" })));
      for (const word of reply.split(" ")) {
        controller.enqueue(encoder.encode(sseChunk(word + " ")));
        await new Promise((r) => setTimeout(r, 20));
      }
      controller.enqueue(encoder.encode(sseChunk("", { finish: "stop" })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export function GET(): Response {
  return Response.json({ ok: true });
}
