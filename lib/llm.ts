/**
 * OpenRouter model client (OpenAI-compatible). The interview brain streams chat
 * completions through this; the model is set by OPENROUTER_MODEL.
 */
import OpenAI from "openai";

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";

// Free model to retry on when the primary errors — e.g. an OpenRouter 402 when
// paid credits run out, or a provider 5xx. This keeps the interview talking
// instead of going silent. Default is a free instruct model that streams plain
// content (no reasoning preamble, so low voice latency). Set to "" to disable.
const FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL ?? "google/gemma-4-31b-it:free";

// Cap the reply length. Without this OpenRouter reserves the model's full
// default max output (~65k tokens) per request and rejects with a 402 the
// moment the account balance can't cover that reservation — even though a
// real interview turn is a sentence or two. A small cap keeps each request
// affordable AND keeps voice replies short. Override with OPENROUTER_MAX_TOKENS.
const MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS) || 1024;

// Reports are a structured JSON object — bigger than a voice turn, but still
// bounded. Cap it (generously) so a one-shot report request doesn't reserve
// the model's full ~65k default and 402 on a low balance like voice turns did.
const REPORT_MAX_TOKENS = Number(process.env.OPENROUTER_REPORT_MAX_TOKENS) || 4096;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  // Fail loud if the key is missing rather than surfacing a confusing 401 deep
  // in the stream. Don't cache a rejected client (mirrors lib/pinecone.ts).
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        ...(process.env.OPENROUTER_SITE_URL
          ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
          : {}),
        ...(process.env.OPENROUTER_APP_NAME
          ? { "X-Title": process.env.OPENROUTER_APP_NAME }
          : {}),
      },
    });
  }
  return client;
}

function errMsg(err: unknown): string {
  if (err instanceof OpenAI.APIError) return `${err.status ?? "?"} ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run `op` on the primary model; if it throws, retry once on FALLBACK_MODEL.
 * Both `chat.completions.create` calls (streaming and one-shot) reject on the
 * initial HTTP error *before* any token is produced, so the fallback kicks in
 * cleanly with nothing emitted yet. A caller-cancelled request is never
 * retried.
 */
async function withFallback<T>(
  op: (model: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await op(MODEL);
  } catch (err) {
    if (signal?.aborted || !FALLBACK_MODEL || FALLBACK_MODEL === MODEL) throw err;
    console.warn(
      `[llm] model "${MODEL}" failed (${errMsg(err)}); retrying on fallback "${FALLBACK_MODEL}"`,
    );
    return op(FALLBACK_MODEL);
  }
}

/** Stream a chat completion. `messages` is OpenAI chat format (system first). */
export async function streamReply(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  signal?: AbortSignal,
) {
  return withFallback(
    (model) =>
      getClient().chat.completions.create(
        { model, messages, stream: true, max_tokens: MAX_TOKENS },
        { signal },
      ),
    signal,
  );
}

/** One-shot (non-streaming) chat completion; returns the assistant text. */
export async function complete(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  const res = await withFallback((model) =>
    getClient().chat.completions.create({
      model,
      messages,
      stream: false,
      max_tokens: REPORT_MAX_TOKENS,
    }),
  );
  return res.choices[0]?.message?.content ?? "";
}
