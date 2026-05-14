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

  -- 玩家自建的手牌范围。一行 = (user, range_id) 的最新快照或墓碑。
  -- 服务端不解读 payload 内部结构，只按 updated_at 做 LWW 合并。
  -- deleted=1 时 payload 可为 NULL，仅保留时间戳供客户端判定本地数据是否应被清掉。
  CREATE TABLE IF NOT EXISTS user_ranges (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    range_id   TEXT    NOT NULL,
    payload    TEXT,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, range_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_ranges_user ON user_ranges(user_id);

  -- 玩家比赛记录。结构与 user_ranges 同形：行级 LWW + 软删除。
  CREATE TABLE IF NOT EXISTS user_tournaments (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tournament_id TEXT    NOT NULL,
    payload       TEXT,
    updated_at    INTEGER NOT NULL,
    deleted       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, tournament_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_tournaments_user ON user_tournaments(user_id);

  -- 玩家偏好（默认深度模板 + 上次打开的范围/深度/座位/对战）。
  -- 整体作为一个 JSON blob 存，按整体的 updated_at 做 LWW。
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
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

// ---------------------------------------------------------------------------
// 同步层：ranges / tournaments / settings 的 LWW upsert + 全量 dump
// ---------------------------------------------------------------------------

export interface SyncItemRow {
  id: string;
  payload: string | null;
  updated_at: number;
  deleted: 0 | 1;
}

export interface SyncSettingsRow {
  payload: string;
  updated_at: number;
}

const listRangesStmt = db.prepare<[number], SyncItemRow>(
  `SELECT range_id AS id, payload, updated_at, deleted
     FROM user_ranges
     WHERE user_id = ?`,
);

const getRangeStmt = db.prepare<[number, string], { updated_at: number }>(
  `SELECT updated_at FROM user_ranges WHERE user_id = ? AND range_id = ?`,
);

const upsertRangeStmt = db.prepare(
  `INSERT INTO user_ranges (user_id, range_id, payload, updated_at, deleted)
     VALUES (@user_id, @id, @payload, @updated_at, @deleted)
   ON CONFLICT(user_id, range_id) DO UPDATE SET
     payload    = excluded.payload,
     updated_at = excluded.updated_at,
     deleted    = excluded.deleted`,
);

const listTournamentsStmt = db.prepare<[number], SyncItemRow>(
  `SELECT tournament_id AS id, payload, updated_at, deleted
     FROM user_tournaments
     WHERE user_id = ?`,
);

const getTournamentStmt = db.prepare<[number, string], { updated_at: number }>(
  `SELECT updated_at FROM user_tournaments WHERE user_id = ? AND tournament_id = ?`,
);

const upsertTournamentStmt = db.prepare(
  `INSERT INTO user_tournaments (user_id, tournament_id, payload, updated_at, deleted)
     VALUES (@user_id, @id, @payload, @updated_at, @deleted)
   ON CONFLICT(user_id, tournament_id) DO UPDATE SET
     payload    = excluded.payload,
     updated_at = excluded.updated_at,
     deleted    = excluded.deleted`,
);

const getSettingsStmt = db.prepare<[number], SyncSettingsRow>(
  `SELECT payload, updated_at FROM user_settings WHERE user_id = ?`,
);

const upsertSettingsStmt = db.prepare(
  `INSERT INTO user_settings (user_id, payload, updated_at)
     VALUES (@user_id, @payload, @updated_at)
   ON CONFLICT(user_id) DO UPDATE SET
     payload    = excluded.payload,
     updated_at = excluded.updated_at`,
);

export interface SyncItemInput {
  id: string;
  /** 客户端拍下的版本时间戳；服务端比这个值大才会写入。 */
  updatedAt: number;
  deleted?: boolean;
  /** deleted=true 时允许为 null/undefined。 */
  payload?: unknown;
}

/**
 * 把一组客户端项按 LWW 写入指定 (table) 表。
 * 返回每个 id 的最终决议：'applied' = 写入了客户端版本，'skipped' = 服务端版本更新被保留。
 */
function applyLww(
  userId: number,
  items: SyncItemInput[],
  getStmt: typeof getRangeStmt,
  upsertStmt: typeof upsertRangeStmt,
): Record<string, 'applied' | 'skipped'> {
  const result: Record<string, 'applied' | 'skipped'> = {};
  const tx = db.transaction(() => {
    for (const item of items) {
      if (typeof item.id !== 'string' || !item.id) continue;
      if (typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) continue;
      const existing = getStmt.get(userId, item.id);
      if (existing && existing.updated_at >= item.updatedAt) {
        result[item.id] = 'skipped';
        continue;
      }
      const deleted = item.deleted === true ? 1 : 0;
      // 删除项保留 id 但 payload 写 NULL，节省空间。
      const payload = deleted || item.payload === undefined
        ? deleted
          ? null
          : JSON.stringify(item.payload ?? null)
        : JSON.stringify(item.payload);
      upsertStmt.run({
        user_id: userId,
        id: item.id,
        payload,
        updated_at: item.updatedAt,
        deleted,
      });
      result[item.id] = 'applied';
    }
  });
  tx();
  return result;
}

export function listRangesForUser(userId: number): SyncItemRow[] {
  return listRangesStmt.all(userId);
}

export function pushRangesForUser(
  userId: number,
  items: SyncItemInput[],
): Record<string, 'applied' | 'skipped'> {
  return applyLww(userId, items, getRangeStmt, upsertRangeStmt);
}

export function listTournamentsForUser(userId: number): SyncItemRow[] {
  return listTournamentsStmt.all(userId);
}

export function pushTournamentsForUser(
  userId: number,
  items: SyncItemInput[],
): Record<string, 'applied' | 'skipped'> {
  return applyLww(userId, items, getTournamentStmt, upsertTournamentStmt);
}

export function getSettingsForUser(userId: number): SyncSettingsRow | undefined {
  return getSettingsStmt.get(userId);
}

export function pushSettingsForUser(
  userId: number,
  payload: unknown,
  updatedAt: number,
): 'applied' | 'skipped' {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return 'skipped';
  const existing = getSettingsStmt.get(userId);
  if (existing && existing.updated_at >= updatedAt) return 'skipped';
  upsertSettingsStmt.run({
    user_id: userId,
    payload: JSON.stringify(payload ?? {}),
    updated_at: updatedAt,
  });
  return 'applied';
}
