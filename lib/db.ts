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

export default db;
