# Migrate RAG from local (LanceDB + transformers.js) to Pinecone

**Date:** 2026-06-06
**Branch:** feat/interview-intake
**Status:** Design — approved, pending spec review

## Goal

Replace the local RAG layer entirely with Pinecone. After this change there is
**no embedding model and no vector store running in the repo/process** — Pinecone
hosts both via an integrated index. Session creation continues to work exactly as
today from the caller's point of view; only the storage/embedding backend changes.

## Decisions (locked)

1. **Embeddings:** Pinecone **integrated index** — Pinecone embeds text
   server-side on both upsert and query. Drops all local embedding code.
2. **Isolation:** **one Pinecone namespace per `session_id`**. Stronger than
   today's `WHERE session_id` filter — a query in one namespace physically cannot
   read another's records.

## Out of scope

- Wiring `retrieve()` into a live request path. It is defined but currently unused
  (the `/api/llm` route is still the Day-0 echo spike). This migration keeps
  `retrieve()` working; it does not change who calls it.
- Adding a test runner / CI test harness (none exists in the project today).
- Re-embedding any existing local data. `.data/lancedb` is a dev-only artifact and
  is abandoned, not migrated.

## Current state (what we are replacing)

- `lib/embeddings.ts` — `@xenova/transformers`, model `Xenova/all-MiniLM-L6-v2`,
  384-dim, in-process. **Deleted by this migration.**
- `lib/rag.ts` — `@lancedb/lancedb`, single table `docs`, rows
  `{ vector, session_id, kind, text }`, isolation via SQL `WHERE session_id`.
  **Body rewritten to call Pinecone; public API unchanged.**
- `lib/paths.ts` — exports `LANCE_DIR`. **`LANCE_DIR` removed**; `DATA_DIR` stays
  (SQLite still uses it).
- `app/api/sessions/route.ts` — the only consumer. Calls `addSessionDocs` and
  `deleteSessionDocs`. **Unchanged** by this migration.
- deps: `@lancedb/lancedb`, `@xenova/transformers`. **Removed.**

## Target architecture

### Dependency changes
- Remove `@lancedb/lancedb`, `@xenova/transformers`.
- Add `@pinecone-database/pinecone` (latest).

### `lib/pinecone.ts` (new)
Client + index-handle singleton.

```ts
import { Pinecone } from "@pinecone-database/pinecone";

const INDEX_NAME = process.env.PINECONE_INDEX ?? "interview-docs";

let clientPromise: Promise<Pinecone> | null = null;
// lazy, and DO NOT cache a rejected promise (mirror the existing rag/embeddings
// resilience pattern: one transient failure must not wedge every later request).
```

- Reads `PINECONE_API_KEY` from env (the `Pinecone` constructor picks it up
  automatically; we pass it explicitly for clarity).
- Exposes a helper to get an index handle scoped to a namespace, e.g.
  `index(namespace: string)` returning `pc.index({ name: INDEX_NAME, namespace })`.
- Does **not** create the index. The index is provisioned once, out of band
  (see "Index provisioning").

### Index provisioning (one-time, not in the request path)
Created via the Pinecone MCP / CLI before deploy, not by app code:

- `createIndexForModel`:
  - `name: "interview-docs"`
  - `cloud: "aws"`, `region: "us-east-1"`
  - `embed: { model: "multilingual-e5-large", fieldMap: { text: "text" } }`
  - `waitUntilReady: true`
- `multilingual-e5-large` → 1024-dim, cosine. Dimension/metric are derived from
  the model; we do not pass them.
- Record field that holds embeddable text is **`text`** (matches `fieldMap.text`),
  keeping the existing field name.

### Record schema (integrated index)
Per record: `{ id, text, kind }`.
- `id`: unique **within the namespace**. Use `` `${kind}-${i}` `` (kinds are
  `cv` / `jd` / `company`, one document each, so this is unique).
- `text`: the chunk (the embeddable field; matches `fieldMap`).
- `kind`: extra top-level field → automatically stored as metadata, returned on
  search.
- Reserved-field rules: field names must not start with `_` or `$`. `text`/`kind`
  are fine. Do **not** include a `metadata` field; do **not** include a
  `vector`/`values` field (integrated index embeds the text itself).

### `lib/rag.ts` (rewritten body, same public API)

Keep, unchanged in spirit:
- `chunk(text, size=800)` — ~800-char chunks for retrieval granularity.
- `assertSessionId(id)` — UUID guard. Still required: the `session_id` becomes the
  **namespace name**, so it must be a clean, validated value.
- `escapeSql` — **deleted** (no SQL anymore).

```ts
export async function addSessionDocs(
  sessionId: string,
  docs: { kind: string; text: string }[],
): Promise<void> {
  assertSessionId(sessionId);
  const records: { id: string; text: string; kind: string }[] = [];
  for (const doc of docs) {
    const pieces = chunk(doc.text);
    pieces.forEach((text, i) =>
      records.push({ id: `${doc.kind}-${i}`, text, kind: doc.kind }),
    );
  }
  if (records.length === 0) return;
  const idx = index(sessionId);
  // Batch ≤ 96 records/request (integrated upsert cap).
  for (const batch of chunked(records, 96)) {
    await idx.upsertRecords({ records: batch });
  }
}

export async function retrieve(
  query: string,
  sessionId: string,
  k = 5,
): Promise<{ kind: string; text: string }[]> {
  assertSessionId(sessionId);
  const res = await index(sessionId).searchRecords({
    query: { topK: k, inputs: { text: query } },
  });
  // NOTE: pin the exact hit shape against the installed SDK types at impl time
  // (result.hits[].fields vs matches[].record — doc samples disagreed).
  return /* hits */ [].map((h) => ({ kind: String(h.kind), text: String(h.text) }));
}

export async function deleteSessionDocs(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  try {
    await index(sessionId).deleteAll();
  } catch (err) {
    // A namespace that was never created (0 docs added) 404s on deleteAll.
    // Treat "namespace not found" as a no-op; rethrow anything else.
  }
}
```

### `app/api/sessions/route.ts`
No change. Same imports (`addSessionDocs`, `deleteSessionDocs` from `@/lib/rag`),
same create-then-rollback flow. Its `catch` already best-effort-swallows cleanup
errors, so a `deleteSessionDocs` 404 on a partial failure is already handled.

### Env / config
- `PINECONE_API_KEY` — already set in `.env`.
- `PINECONE_INDEX` — new, optional, defaults to `interview-docs`. Add to `.env`
  and document in README.

## Error handling & resilience

- `lib/pinecone.ts` lazy singleton must not cache a rejected promise (same reason
  the current `getTable`/`getExtractor` don't).
- `addSessionDocs` failure mid-way (e.g. some batches upserted, then a network
  error) → the route's existing rollback calls `deleteSessionDocs`, which
  `deleteAll`s the whole namespace, cleaning up any partially-upserted records.
- `deleteSessionDocs` on a never-created namespace: swallow not-found, rethrow
  other errors.

## Verification

No test runner exists; do not add one. Instead:

1. **Pure helpers** stay trivially testable: `chunk()` and `assertSessionId()`
   have no I/O.
2. **`scripts/rag-smoke.ts`** (new, runnable manually, e.g. `npx tsx scripts/rag-smoke.ts`):
   - mint a throwaway UUID
   - `addSessionDocs(uuid, [{kind:"cv",text:"…"}, {kind:"jd",text:"…"}])`
   - poll/`retrieve("…", uuid)` and assert it returns the seeded docs and
     **nothing** from a second, different UUID namespace (proves isolation)
   - `deleteSessionDocs(uuid)` and assert subsequent retrieve is empty
   - This exercises the real Pinecone round-trip end to end.
3. `npm run build` / typecheck passes with the new SDK and the two removed deps
   gone from `package.json` and from all imports.

## Risks / notes

- **Latency:** the original design chose local embeddings for a latency budget;
  integrated retrieval now adds a network hop per query. Acceptable now because
  `retrieve()` is not on any live path yet; revisit when the brain is built
  (options then: rerank, caching, or co-locating region).
- **Eventual consistency:** Pinecone upserts are not immediately queryable; the
  smoke script must poll/retry retrieve after upsert.
- **SDK response shape:** resolve `searchRecords` hit shape against installed
  types before finalizing `retrieve()`.
