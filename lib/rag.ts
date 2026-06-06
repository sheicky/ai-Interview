/**
 * Session-scoped RAG over LanceDB.
 *
 * One table `docs`; every row is tagged with `session_id`. Retrieval filters on
 * session_id, so an interview can ONLY ever retrieve its own CV / JD / company
 * docs. That metadata filter is the no-cross-session-leak guarantee (proves R2).
 *
 *   addSessionDocs(sid, [{kind, text}])  → chunk → embed → insert tagged sid
 *   retrieve(query, sid)                 → embed query → search WHERE session_id = sid
 */
import * as lancedb from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import { embed, EMBED_DIM } from "./embeddings";
import { LANCE_DIR } from "./paths";

const TABLE = "docs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The `.where(session_id = '…')` filter is the no-cross-session-leak barrier, so
 *  the id must never depend on string escaping to stay safe. Require a real UUID
 *  (route mints randomUUID()) before any value reaches the filter. */
function assertSessionId(id: string): void {
  if (!UUID_RE.test(id)) throw new Error("invalid session id");
}

interface DocRecord {
  vector: number[];
  session_id: string;
  kind: string;
  text: string;
  // lancedb's createTable/add expect Record<string, unknown>-compatible rows.
  [key: string]: unknown;
}

let tablePromise: Promise<lancedb.Table> | null = null;

async function getTable(): Promise<lancedb.Table> {
  // Don't cache a rejected promise: one transient cold-start failure would
  // otherwise wedge every later request into a permanent 500 until restart.
  if (!tablePromise) {
    tablePromise = openOrCreate().catch((err) => {
      tablePromise = null;
      throw err;
    });
  }
  return tablePromise;
}

async function openOrCreate(): Promise<lancedb.Table> {
  mkdirSync(LANCE_DIR, { recursive: true });
  const db = await lancedb.connect(LANCE_DIR);
  const names = await db.tableNames();
  if (names.includes(TABLE)) return db.openTable(TABLE);
  // Create with an explicit schema by seeding one row, then removing it.
  // existOk makes this idempotent across concurrent workers/processes racing the
  // cold path — the loser opens the existing table instead of throwing. A leftover
  // __seed__ row is harmless: its session_id can never match a real UUID filter.
  const seed: DocRecord = {
    vector: new Array(EMBED_DIM).fill(0),
    session_id: "__seed__",
    kind: "seed",
    text: "",
  };
  const table = await db.createTable(TABLE, [seed], { existOk: true });
  await table.delete("session_id = '__seed__'");
  return table;
}

/** Split text into ~800-char chunks for better retrieval granularity. */
function chunk(text: string, size = 800): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function addSessionDocs(
  sessionId: string,
  docs: { kind: string; text: string }[],
): Promise<void> {
  assertSessionId(sessionId);
  const records: DocRecord[] = [];
  for (const doc of docs) {
    const pieces = chunk(doc.text);
    if (pieces.length === 0) continue;
    const vectors = await embed(pieces);
    pieces.forEach((text, i) =>
      records.push({ vector: vectors[i], session_id: sessionId, kind: doc.kind, text }),
    );
  }
  if (records.length === 0) return;
  const table = await getTable();
  await table.add(records);
}

export async function retrieve(
  query: string,
  sessionId: string,
  k = 5,
): Promise<{ kind: string; text: string }[]> {
  assertSessionId(sessionId);
  const [qv] = await embed([query]);
  if (!qv) return [];
  const table = await getTable();
  const rows = await table
    .search(qv)
    .where(`session_id = '${escapeSql(sessionId)}'`)
    .limit(k)
    .toArray();
  return rows.map((r) => ({ kind: String(r.kind), text: String(r.text) }));
}

/** Remove a session's docs. Used to compensate when session creation fails partway. */
export async function deleteSessionDocs(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  const table = await getTable();
  await table.delete(`session_id = '${escapeSql(sessionId)}'`);
}
