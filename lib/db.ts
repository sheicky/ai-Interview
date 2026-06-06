/**
 * SQLite (better-sqlite3) — sessions, turns, reports.
 * One file under DATA_DIR. Tables created on first import.
 *
 *   sessions ──1:N──▶ turns        (the interview transcript)
 *           ──1:1──▶ reports       (the end-of-interview report)
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    company     TEXT NOT NULL,
    company_url TEXT,
    created_at  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'created',
    ended_at    TEXT
  );
  CREATE TABLE IF NOT EXISTS turns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts         TEXT NOT NULL,
    role       TEXT NOT NULL,
    text       TEXT NOT NULL,
    phase      TEXT,
    latency_ms INTEGER
  );
  CREATE TABLE IF NOT EXISTS reports (
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    json       TEXT NOT NULL
  );
`);

export interface NewSession {
  id: string;
  company: string;
  companyUrl?: string;
}

export function createSession(s: NewSession): void {
  db.prepare(
    `INSERT INTO sessions (id, company, company_url, created_at, status)
     VALUES (?, ?, ?, ?, 'created')`,
  ).run(s.id, s.company, s.companyUrl ?? null, new Date().toISOString());
}

/** Remove a session row. Used to compensate when indexing fails mid-create. */
export function deleteSession(id: string): void {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export interface SessionRow {
  id: string;
  company: string;
  company_url: string | null;
  created_at: string;
  status: string;
  ended_at: string | null;
}

/** Fetch a session row (used to put the company name in the interviewer prompt). */
export function getSession(id: string): SessionRow | undefined {
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | SessionRow
    | undefined;
}

/** Append one transcript turn. `latency_ms` is time-to-first-token for assistant turns. */
export function addTurn(t: {
  sessionId: string;
  role: string;
  text: string;
  phase?: string;
  latencyMs?: number;
}): void {
  db.prepare(
    `INSERT INTO turns (session_id, ts, role, text, phase, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    t.sessionId,
    new Date().toISOString(),
    t.role,
    t.text,
    t.phase ?? null,
    t.latencyMs ?? null,
  );
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
export function getTurns(sessionId: string): TurnRow[] {
  return db
    .prepare(`SELECT * FROM turns WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as TurnRow[];
}

export interface ReportRow {
  session_id: string;
  created_at: string;
  json: string;
}

/** Fetch a stored report (undefined if none). */
export function getReport(sessionId: string): ReportRow | undefined {
  return db.prepare(`SELECT * FROM reports WHERE session_id = ?`).get(sessionId) as
    | ReportRow
    | undefined;
}

/** Upsert a report (one per session). */
export function saveReport(sessionId: string, json: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO reports (session_id, created_at, json) VALUES (?, ?, ?)`,
  ).run(sessionId, new Date().toISOString(), json);
}

/** Remove a session's report (used in test cleanup). */
export function deleteReport(sessionId: string): void {
  db.prepare(`DELETE FROM reports WHERE session_id = ?`).run(sessionId);
}

export default db;
