# Pinecone RAG Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local RAG layer (transformers.js embeddings + LanceDB store) with Pinecone's integrated index, so no embedding model or vector store runs in-process.

**Architecture:** A single Pinecone integrated index (`multilingual-e5-large`, server-side embedding) holds all session docs. Each `session_id` is its own namespace, giving physical cross-session isolation. `lib/rag.ts` keeps its public API (`addSessionDocs` / `retrieve` / `deleteSessionDocs`); only its body changes. A new `lib/pinecone.ts` owns the client/index handle. `lib/embeddings.ts` is deleted.

**Tech Stack:** Next.js 16 (nodejs runtime), TypeScript, `@pinecone-database/pinecone` ^7.2.0, `tsx` (devDep, to run the smoke script).

**Spec:** `docs/superpowers/specs/2026-06-06-pinecone-rag-migration-design.md`

---

## File Structure

- **Create** `lib/pinecone.ts` — Pinecone client + namespace-scoped index handle (lazy singleton).
- **Rewrite** `lib/rag.ts` — same exports, Pinecone body. Keep `chunk()` + `assertSessionId()`; delete `escapeSql()` and all LanceDB code.
- **Delete** `lib/embeddings.ts` — no local embedding model anymore.
- **Modify** `lib/paths.ts` — remove `LANCE_DIR`; keep `DATA_DIR`.
- **Modify** `package.json` — remove `@lancedb/lancedb`, `@xenova/transformers`; add `@pinecone-database/pinecone`; add `tsx` devDep.
- **Modify** `.env`, `.env.example` — document `PINECONE_API_KEY` + `PINECONE_INDEX`.
- **Modify** `README.md` — update the RAG-layer description.
- **Create** `scripts/rag-smoke.ts` — real end-to-end round-trip + isolation check + pure-helper assertions.
- **Unchanged (verify only)** `app/api/sessions/route.ts`.

---

## Task 1: Provision the Pinecone index (one-time infra)

**Files:** none (out-of-band via Pinecone MCP/CLI).

- [ ] **Step 1: Confirm no index exists yet**

Use the Pinecone MCP `list-indexes` tool. Expected: `{ "indexes": [] }` (or that `interview-docs` is absent).

- [ ] **Step 2: Create the integrated index**

Use the Pinecone MCP `create-index-for-model` tool with:
- `name`: `interview-docs`
- `cloud`: `aws`
- `region`: `us-east-1`
- `embed`: `{ "model": "multilingual-e5-large", "fieldMap": { "text": "text" } }`

`multilingual-e5-large` → 1024-dim, cosine (derived from the model; not passed).

- [ ] **Step 3: Verify it is ready**

Use the Pinecone MCP `describe-index` tool with `name: interview-docs`.
Expected: status `ready: true`, `dimension: 1024`, `metric: cosine`, and the embed
config showing `model: multilingual-e5-large`, `fieldMap.text: text`.

---

## Task 2: Swap dependencies and config

**Files:**
- Modify: `package.json`
- Modify: `.env`, `.env.example`

- [ ] **Step 1: Remove old deps, add new ones**

Run:
```bash
cd /Users/sheickalisimpore/ai-cs/ai-Customer-Service
npm uninstall @lancedb/lancedb @xenova/transformers
npm install @pinecone-database/pinecone@^7.2.0
npm install -D tsx
```

- [ ] **Step 2: Verify package.json no longer references the old deps**

Run: `grep -E "lancedb|xenova" package.json`
Expected: no output (exit 1).

Run: `grep -E "pinecone-database|tsx" package.json`
Expected: both present.

- [ ] **Step 3: Add PINECONE_INDEX to `.env`**

`.env` already has `PINECONE_API_KEY`. Append:
```
# Pinecone integrated index name (created via create-index-for-model).
PINECONE_INDEX=interview-docs
```

- [ ] **Step 4: Document both vars in `.env.example`**

Add under the existing keys:
```
# Pinecone (RAG store + server-side embeddings).
# PINECONE_API_KEY=pcsk_...
# PINECONE_INDEX=interview-docs
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: swap local RAG deps for @pinecone-database/pinecone"
```
(`.env` is gitignored; do not commit it.)

---

## Task 3: Pin the SDK method signatures

**Files:** none (read-only inspection — prevents coding against the wrong shape).

- [ ] **Step 1: Find the upsertRecords signature**

Run:
```bash
grep -rn "upsertRecords" node_modules/@pinecone-database/pinecone/dist/*.d.ts
```
Expected: a method like `upsertRecords(records: Array<PineconeRecord...>)` or
`upsertRecords({ records }): Promise<void>`. **Record the exact argument shape**
(array directly vs `{ records }` wrapper) and the id field name (`_id` vs `id`).

- [ ] **Step 2: Find the searchRecords signature and response type**

Run:
```bash
grep -rn "searchRecords\|SearchRecordsResponse\|class IndexNamespace\|hits" node_modules/@pinecone-database/pinecone/dist/*.d.ts | head -40
```
Expected response shape (SDK v7): `{ result: { hits: Array<{ _id: string; _score: number; fields: Record<string, any> }> }; usage: {...} }`.
**Record** whether hits live at `result.hits` and whether row data is under `fields`.

- [ ] **Step 3: Find the namespace + deleteAll signatures**

Run:
```bash
grep -rn "namespace\|deleteAll\|deleteNamespace" node_modules/@pinecone-database/pinecone/dist/*.d.ts | head -30
```
Expected: `index.namespace(name)` returns a namespace-scoped handle exposing
`upsertRecords`, `searchRecords`, `deleteAll`.

> If any signature differs from what Tasks 4–5 assume below, adjust the code in
> those tasks to match the `.d.ts` — the `.d.ts` is authoritative, not this plan.

---

## Task 4: Create `lib/pinecone.ts`

**Files:**
- Create: `lib/pinecone.ts`

- [ ] **Step 1: Write the client + index-handle singleton**

```ts
/**
 * Pinecone client + namespace-scoped index handle.
 *
 * One integrated index (server-side embeddings, model multilingual-e5-large)
 * named by PINECONE_INDEX. Each interview session uses its own namespace, so a
 * query in one session physically cannot read another's docs.
 */
import { Pinecone, type Index } from "@pinecone-database/pinecone";

const INDEX_NAME = process.env.PINECONE_INDEX ?? "interview-docs";

let client: Pinecone | null = null;

function getClient(): Pinecone {
  // The constructor reads PINECONE_API_KEY from env. Fail loud if it's missing,
  // rather than letting an unauthenticated request 401 deep in a handler.
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY is not set");
  }
  if (!client) client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  return client;
}

/** A handle to the index scoped to one session's namespace. */
export function sessionIndex(namespace: string): Index {
  return getClient().index(INDEX_NAME).namespace(namespace);
}
```

> If Task 3 showed `index({ name, namespace })` is the only supported form,
> use that instead of `.index(NAME).namespace(ns)`. Keep the `sessionIndex` API.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `lib/pinecone.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/pinecone.ts
git commit -m "feat: add Pinecone client + per-session index handle"
```

---

## Task 5: Rewrite `lib/rag.ts`

**Files:**
- Rewrite: `lib/rag.ts`

- [ ] **Step 1: Replace the file with the Pinecone implementation**

```ts
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
  for (const doc of docs) {
    chunk(doc.text).forEach((text, i) =>
      records.push({ _id: `${doc.kind}-${i}`, text, kind: doc.kind }),
    );
  }
  if (records.length === 0) return;
  const idx = sessionIndex(sessionId);
  for (const batch of batches(records, UPSERT_BATCH)) {
    await idx.upsertRecords(batch);
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
```

> Adjust `idx.upsertRecords(batch)` to `idx.upsertRecords({ records: batch })` and
> `res.result.hits` / `h.fields` to whatever Task 3 recorded, if they differ.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `searchRecords`/`upsertRecords` shapes differ, fix per Task 3.)

- [ ] **Step 3: Commit**

```bash
git add lib/rag.ts
git commit -m "feat: back session RAG with Pinecone namespaces"
```

---

## Task 6: Delete `lib/embeddings.ts` and clean `lib/paths.ts`

**Files:**
- Delete: `lib/embeddings.ts`
- Modify: `lib/paths.ts`

- [ ] **Step 1: Delete the local embeddings module**

Run: `git rm lib/embeddings.ts`

- [ ] **Step 2: Remove LANCE_DIR from `lib/paths.ts`**

Replace the file with:
```ts
/** Shared on-disk location for the SQLite DB. Single source of truth so db.ts
 *  uses one root. (Vector storage now lives in Pinecone, not on disk.) */
export const DATA_DIR = process.env.DATA_DIR ?? ".data";
```

- [ ] **Step 3: Verify nothing still imports the deleted code**

Run:
```bash
grep -rn "embeddings\|LANCE_DIR\|lancedb\|EMBED_DIM\|@xenova" app lib scripts
```
Expected: no output (exit 1).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add lib/paths.ts
git commit -m "chore: drop local embeddings module and LanceDB path"
```

---

## Task 7: End-to-end smoke verification

**Files:**
- Create: `scripts/rag-smoke.ts`

- [ ] **Step 1: Write the smoke script (the failing test)**

```ts
/**
 * Real round-trip + isolation check against Pinecone. Run manually:
 *   npx tsx scripts/rag-smoke.ts
 * Requires PINECONE_API_KEY and PINECONE_INDEX in the environment.
 */
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { chunk, addSessionDocs, retrieve, deleteSessionDocs } from "../lib/rag";

function ok(name: string) {
  console.log(`✓ ${name}`);
}

async function retryRetrieve(q: string, sid: string, tries = 10) {
  // Pinecone upserts are eventually consistent; poll until visible.
  for (let i = 0; i < tries; i++) {
    const hits = await retrieve(q, sid);
    if (hits.length > 0) return hits;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return [];
}

async function main() {
  // --- pure helpers ---
  assert.deepEqual(chunk(""), []);
  assert.equal(chunk("a".repeat(900)).length, 2);
  ok("chunk() splits at ~800 chars and ignores empty");

  const sidA = randomUUID();
  const sidB = randomUUID();
  try {
    await addSessionDocs(sidA, [
      { kind: "cv", text: "Jane Doe is a senior payments engineer who built Stripe integrations." },
      { kind: "jd", text: "We are hiring a backend engineer for our billing platform." },
    ]);
    await addSessionDocs(sidB, [
      { kind: "cv", text: "John Smith is a marine biologist studying coral reefs." },
    ]);

    const hitsA = await retryRetrieve("payments billing experience", sidA);
    assert.ok(hitsA.length > 0, "session A should return its own docs");
    assert.ok(
      hitsA.every((h) => !h.text.toLowerCase().includes("coral")),
      "session A must NOT see session B's docs",
    );
    ok("retrieve() returns own docs and is isolated from other namespaces");

    await deleteSessionDocs(sidA);
    const afterDelete = await retrieve("payments billing experience", sidA);
    assert.equal(afterDelete.length, 0, "deleted session should return nothing");
    ok("deleteSessionDocs() clears the namespace");

    console.log("\nALL SMOKE CHECKS PASSED");
  } finally {
    await deleteSessionDocs(sidA).catch(() => {});
    await deleteSessionDocs(sidB).catch(() => {});
  }
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it — expect it to exercise the real round-trip**

Run:
```bash
set -a; . ./.env; set +a; npx tsx scripts/rag-smoke.ts
```
Expected output ends with `ALL SMOKE CHECKS PASSED`. If isolation or delete
assertions fail, fix `lib/rag.ts` (likely the hit-shape mapping or namespace
wiring) and re-run — do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
git add scripts/rag-smoke.ts
git commit -m "test: add Pinecone RAG round-trip + isolation smoke script"
```

---

## Task 8: Verify the consumer is untouched and docs are current

**Files:**
- Verify only: `app/api/sessions/route.ts`
- Modify: `README.md`

- [ ] **Step 1: Confirm the sessions route still compiles unchanged**

Run: `grep -n "addSessionDocs\|deleteSessionDocs" app/api/sessions/route.ts`
Expected: same two usages as before; no edits needed. Confirm `npx tsc --noEmit` passes.

- [ ] **Step 2: Update the RAG section of README.md**

Find the README passage describing local embeddings / LanceDB and replace it with
a description of the Pinecone integrated index + namespace-per-session model and
the `PINECONE_API_KEY` / `PINECONE_INDEX` env vars. (Match the README's existing
tone and structure; do not restructure unrelated sections.)

- [ ] **Step 3: Final build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe Pinecone-backed RAG layer"
```

---

## Done criteria

- `grep -rE "lancedb|xenova|EMBED_DIM|LANCE_DIR" app lib scripts package.json` → no output.
- `npx tsc --noEmit` and `npm run build` pass.
- `npx tsx scripts/rag-smoke.ts` prints `ALL SMOKE CHECKS PASSED` (real Pinecone round-trip + cross-namespace isolation + delete).
- `app/api/sessions/route.ts` unchanged.
