/**
 * OpenRouter model client (OpenAI-compatible). The interview brain streams chat
 * completions through this; the model is set by OPENROUTER_MODEL.
 */
import OpenAI from "openai";

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6";

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

/** Stream a chat completion. `messages` is OpenAI chat format (system first). */
export async function streamReply(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  signal?: AbortSignal,
) {
  return getClient().chat.completions.create(
    { model: MODEL, messages, stream: true },
    { signal },
  );
}

/** One-shot (non-streaming) chat completion; returns the assistant text. */
export async function complete(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: MODEL,
    messages,
    stream: false,
  });
  return res.choices[0]?.message?.content ?? "";
}
