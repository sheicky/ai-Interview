/**
 * libSQL (Turso) data layer — sessions, turns, reports.
 * Dev/test: a local file DB under DATA_DIR. Production (Vercel): a Turso
 * libsql:// URL via DATABASE_URL + DATABASE_AUTH_TOKEN. Schema created once.
 *
 *   sessions ──1:N──▶ turns        (the interview transcript)
 *           ──1:1──▶ reports       (the end-of-interview report)
 */
import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

function makeUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  mkdirSync(DATA_DIR, { recursive: true }); // file: needs the dir to exist
  return `file:${join(DATA_DIR, "app.db")}`;
}

const db: Client = createClient({
  url: makeUrl(),
  authToken: process.env.DATABASE_AUTH_TOKEN, // undefined for file: URLs — fine
});

// Schema created once; every query awaits this first.
let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = db
      .batch(
        [
          `CREATE TABLE IF NOT EXISTS sessions (
             id TEXT PRIMARY KEY,
             company TEXT NOT NULL,
             company_url TEXT,
             role TEXT,
             created_at TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'created',
             ended_at TEXT
           )`,
          `CREATE TABLE IF NOT EXISTS turns (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL,
             ts TEXT NOT NULL,
             role TEXT NOT NULL,
             text TEXT NOT NULL,
             phase TEXT,
             latency_ms INTEGER
           )`,
          `CREATE TABLE IF NOT EXISTS reports (
             session_id TEXT PRIMARY KEY,
             created_at TEXT NOT NULL,
             json TEXT NOT NULL
           )`,
        ],
        "write",
      )
      // Migration for DBs created before `role` existed (e.g. prod Turso):
      // add the column if missing. Ignore the "duplicate column" error.
      .then(() =>
        db
          .execute(`ALTER TABLE sessions ADD COLUMN role TEXT`)
          .then(() => undefined)
          .catch(() => undefined),
      )
      .then(() => undefined)
      .catch((err) => {
        ready = null; // don't cache a failed init
        throw err;
      });
  }
  return ready;
}

export interface NewSession {
  id: string;
  company: string;
  companyUrl?: string;
  role?: string;
}

export async function createSession(s: NewSession): Promise<void> {
  await ensureReady();
  await db.execute({
    sql: `INSERT INTO sessions (id, company, company_url, role, created_at, status)
          VALUES (?, ?, ?, ?, ?, 'created')`,
    args: [s.id, s.company, s.companyUrl ?? null, s.role ?? null, new Date().toISOString()],
  });
}

/** Remove a session row. Used to compensate when indexing fails mid-create. */
export async function deleteSession(id: string): Promise<void> {
  await ensureReady();
  await db.execute({ sql: `DELETE FROM sessions WHERE id = ?`, args: [id] });
}

export interface SessionRow {
  id: string;
  company: string;
  company_url: string | null;
  role: string | null;
  created_at: string;
  status: string;
  ended_at: string | null;
}

export async function getSession(id: string): Promise<SessionRow | undefined> {
  await ensureReady();
  const res = await db.execute({ sql: `SELECT * FROM sessions WHERE id = ?`, args: [id] });
  return res.rows[0] as unknown as SessionRow | undefined;
}

/** Append one transcript turn. `latency_ms` is time-to-first-token for assistant turns. */
export async function addTurn(t: {
  sessionId: string;
  role: string;
  text: string;
  phase?: string;
  latencyMs?: number;
}): Promise<void> {
  await ensureReady();
  await db.execute({
    sql: `INSERT INTO turns (session_id, ts, role, text, phase, latency_ms)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t.sessionId, new Date().toISOString(), t.role, t.text, t.phase ?? null, t.latencyMs ?? null],
  });
}

export interface TurnRow {
  id: number;
  session_id: string;
  ts: string;
  role: string;
  text: string;
  phase: string | null;
  latency_ms: number | null;
}

/** All turns for a session, oldest first. */
export async function getTurns(sessionId: string): Promise<TurnRow[]> {
  await ensureReady();
  const res = await db.execute({
    sql: `SELECT * FROM turns WHERE session_id = ? ORDER BY id ASC`,
    args: [sessionId],
  });
  return res.rows as unknown as TurnRow[];
}

export interface ReportRow {
  session_id: string;
  created_at: string;
  json: string;
}

/** Fetch a stored report (undefined if none). */
export async function getReport(sessionId: string): Promise<ReportRow | undefined> {
  await ensureReady();
  const res = await db.execute({ sql: `SELECT * FROM reports WHERE session_id = ?`, args: [sessionId] });
  return res.rows[0] as unknown as ReportRow | undefined;
}

/** Upsert a report (one per session). */
export async function saveReport(sessionId: string, json: string): Promise<void> {
  await ensureReady();
  await db.execute({
    sql: `INSERT OR REPLACE INTO reports (session_id, created_at, json) VALUES (?, ?, ?)`,
    args: [sessionId, new Date().toISOString(), json],
  });
}

/** Remove a session's report (used in test cleanup). */
export async function deleteReport(sessionId: string): Promise<void> {
  await ensureReady();
  await db.execute({ sql: `DELETE FROM reports WHERE session_id = ?`, args: [sessionId] });
}

/** All sessions, newest first. */
export async function getAllSessions(): Promise<SessionRow[]> {
  await ensureReady();
  const res = await db.execute(`SELECT * FROM sessions ORDER BY created_at DESC`);
  return res.rows as unknown as SessionRow[];
}

/** All stored reports. */
export async function getAllReports(): Promise<ReportRow[]> {
  await ensureReady();
  const res = await db.execute(`SELECT * FROM reports`);
  return res.rows as unknown as ReportRow[];
}

/** Per-session count of candidate (role='user') turns — a proxy for interview length. */
export async function getCandidateTurnCounts(): Promise<number[]> {
  await ensureReady();
  const res = await db.execute(`SELECT COUNT(*) AS n FROM turns WHERE role = 'user' GROUP BY session_id`);
  return res.rows.map((r) => Number((r as unknown as { n: number | bigint }).n));
}

export default db;
