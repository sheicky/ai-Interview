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
import { join } from "node:path";
import { embed, EMBED_DIM } from "./embeddings";

const DATA_DIR = process.env.DATA_DIR ?? ".data";
const LANCE_DIR = join(DATA_DIR, "lancedb");
const TABLE = "docs";

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
  if (!tablePromise) tablePromise = openOrCreate();
  return tablePromise;
}

async function openOrCreate(): Promise<lancedb.Table> {
  mkdirSync(LANCE_DIR, { recursive: true });
  const db = await lancedb.connect(LANCE_DIR);
  const names = await db.tableNames();
  if (names.includes(TABLE)) return db.openTable(TABLE);
  // Create with an explicit schema by seeding one row, then removing it.
  const seed: DocRecord = {
    vector: new Array(EMBED_DIM).fill(0),
    session_id: "__seed__",
    kind: "seed",
    text: "",
  };
  const table = await db.createTable(TABLE, [seed]);
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
