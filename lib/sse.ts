/**
 * OpenAI chat/completions streaming format. ElevenLabs' custom-LLM transport
 * consumes exactly these `data:` lines, so the interview brain re-emits each
 * model delta as one chunk.
 */
type ChunkOpts = { role?: string; finish?: string | null };

/** One OpenAI `chat.completion.chunk` as an SSE `data:` line. */
export function sseChunk(content: string, opts: ChunkOpts = {}): string {
  const delta: Record<string, string> = {};
  if (opts.role) delta.role = opts.role;
  if (content) delta.content = content;
  const payload = {
    id: "interview",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "interview",
    choices: [{ index: 0, delta, finish_reason: opts.finish ?? null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Terminal SSE line ElevenLabs expects to end the stream. */
export const SSE_DONE = "data: [DONE]\n\n";
