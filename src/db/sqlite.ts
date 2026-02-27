import Database from 'better-sqlite3';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
// One row per OAuth session. Only the refresh_token is stored — access tokens
// are obtained at call time and are never persisted.
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    session_id    TEXT    PRIMARY KEY,
    refresh_token TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )
`;

// ---------------------------------------------------------------------------
// Singleton connection
// ---------------------------------------------------------------------------
let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(env.DB_PATH);
    db.pragma('journal_mode = WAL');   // better concurrent read performance
    db.pragma('foreign_keys = ON');
    db.exec(CREATE_TABLE);
    logger.info({ dbPath: env.DB_PATH }, 'SQLite database initialised');
  }
  return db;
}

// ---------------------------------------------------------------------------
// Token CRUD — never accept or return raw credentials beyond what's needed
// ---------------------------------------------------------------------------

/** Persist (or replace) a refresh token for a given session. */
export function upsertSession(sessionId: string, refreshToken: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions (session_id, refresh_token, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         refresh_token = excluded.refresh_token,
         updated_at    = excluded.updated_at`
    )
    .run(sessionId, refreshToken, now, now);
}

/** Retrieve the refresh token for a session. Returns null if not found. */
export function getRefreshToken(sessionId: string): string | null {
  const row = getDb()
    .prepare('SELECT refresh_token FROM sessions WHERE session_id = ?')
    .get(sessionId) as { refresh_token: string } | undefined;

  return row?.refresh_token ?? null;
}

/** Check whether a session exists (without retrieving the token). */
export function sessionExists(sessionId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM sessions WHERE session_id = ?')
    .get(sessionId);

  return row !== undefined;
}

/** Delete a session (e.g. on explicit logout or token revocation). */
export function deleteSession(sessionId: string): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE session_id = ?')
    .run(sessionId);
}
