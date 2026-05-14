import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './env.js';

const dbPath = resolve(env.DB_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id     TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT,
    picture       TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface UserRow {
  id: number;
  google_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  created_at: string;
  last_login_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO users (google_id, email, name, picture)
  VALUES (@google_id, @email, @name, @picture)
  ON CONFLICT(google_id) DO UPDATE SET
    email         = excluded.email,
    name          = excluded.name,
    picture       = excluded.picture,
    last_login_at = datetime('now')
  RETURNING *;
`);

const findByIdStmt = db.prepare<[number], UserRow>(`SELECT * FROM users WHERE id = ?`);

export function upsertUserFromGoogle(input: {
  google_id: string;
  email: string;
  name: string | null;
  picture: string | null;
}): UserRow {
  return insertStmt.get(input) as UserRow;
}

export function findUserById(id: number): UserRow | undefined {
  return findByIdStmt.get(id);
}
