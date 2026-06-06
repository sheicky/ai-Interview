/**
 * Session-scoped RAG over Pinecone (integrated index, server-side embeddings).
 *
 * Each session_id is its own Pinecone namespace, so an interview can ONLY ever
 * retrieve its own CV / JD / company docs. That namespace boundary is the
 * no-cross-session-leak guarantee.
 *
 *   addSessionDocs(sid, [{kind, text}])  → chunk → upsertRecords into ns=sid
 *   retrieve(query, sid)                 → searchRecords (text) within ns=sid
 *   deleteSessionDocs(sid)               → deleteAll in ns=sid
 */
import { sessionIndex } from "./pinecone";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Integrated upsert caps a request at 96 records; batch to stay under it.
const UPSERT_BATCH = 96;

/** session_id becomes the Pinecone namespace name, so require a real UUID
 *  (route mints randomUUID()) before any value reaches Pinecone. */
function assertSessionId(id: string): void {
  if (!UUID_RE.test(id)) throw new Error("invalid session id");
}

/** Split text into ~800-char chunks for better retrieval granularity. */
export function chunk(text: string, size = 800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function addSessionDocs(
  sessionId: string,
  docs: { kind: string; text: string }[],
): Promise<void> {
  assertSessionId(sessionId);
  // _id unique within the namespace; `text` matches the index fieldMap so
  // Pinecone embeds it; `kind` is stored as metadata.
  const records: { _id: string; text: string; kind: string }[] = [];
  docs.forEach((doc, d) => {
    // `${d}-...` keeps ids unique even if two docs share a kind.
    chunk(doc.text).forEach((text, i) =>
      records.push({ _id: `${d}-${doc.kind}-${i}`, text, kind: doc.kind }),
    );
  });
  if (records.length === 0) return;
  const idx = sessionIndex(sessionId);
  for (const batch of batches(records, UPSERT_BATCH)) {
    await idx.upsertRecords({ records: batch });
  }
}

export async function retrieve(
  query: string,
  sessionId: string,
  k = 5,
): Promise<{ kind: string; text: string }[]> {
  assertSessionId(sessionId);
  const res = await sessionIndex(sessionId).searchRecords({
    query: { topK: k, inputs: { text: query } },
  });
  const hits = res.result?.hits ?? [];
  return hits.map((h) => {
    const f = (h.fields ?? {}) as Record<string, unknown>;
    return { kind: String(f.kind ?? ""), text: String(f.text ?? "") };
  });
}

/** Remove a session's docs. Used to compensate when session creation fails partway. */
export async function deleteSessionDocs(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  try {
    await sessionIndex(sessionId).deleteAll();
  } catch (err) {
    // A namespace that was never created (0 docs added) 404s on deleteAll.
    // Treat "not found" as a no-op; rethrow anything else.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not found|404/i.test(msg)) throw err;
  }
}
