import { useSyncExternalStore } from 'react';
import type { Currency, Tournament } from '@/lib/tournaments';
import { CURRENCIES } from '@/lib/tournaments';
import { newId } from './storage';

/**
 * 简易比赛记录 store：参考 useRangeStore 的 vanilla store + useSyncExternalStore 风格，
 * 但因为数据结构线性、操作较少，没有 draft/persisted 双层概念，直接维护 `tournaments` 数组。
 */

const STORAGE_KEY = 'nlh:tournaments:v1';

interface PersistedShape {
  version: 1;
  tournaments: Tournament[];
  /**
   * 已删除赛事的墓碑：id → 删除时间戳（ms）。
   * 用于云端同步时把"在 A 设备删的"传播到 B 设备。
   */
  tombstones?: Record<string, number>;
}

function sanitizeNumber(v: unknown, fallback = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v;
}

function sanitizeOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

const VALID_CURRENCY_IDS = new Set<string>(CURRENCIES.map((c) => c.id));

function sanitizeCurrency(v: unknown): Currency {
  // 旧数据（无 currency 字段）默认回退到 CNY，保持原 ¥ 语义；
  // 新创建的比赛由表单显式传入。
  if (typeof v === 'string' && VALID_CURRENCY_IDS.has(v)) return v as Currency;
  return 'CNY';
}

function sanitizeTournament(raw: unknown): Tournament | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string') return null;
  const name = r.name.trim();
  if (!name) return null;
  const iconId = typeof r.iconId === 'string' ? r.iconId : '';
  const currency = sanitizeCurrency(r.currency);
  const totalPlayers = sanitizeNumber(r.totalPlayers, 0);
  const tablePlayers = sanitizeNumber(r.tablePlayers, 0);
  const buyIn = sanitizeNumber(r.buyIn, 0);
  const finalRank = sanitizeNumber(r.finalRank, 0);
  const prize = sanitizeNumber(r.prize, 0);
  const hasBounty = r.hasBounty === true;
  const bounty = hasBounty ? sanitizeNumber(r.bounty, 0) : 0;
  const createdAt =
    typeof r.createdAt === 'string' && r.createdAt
      ? r.createdAt
      : new Date().toISOString();
  // 旧数据无 updatedAt → 回退到 createdAt，使 LWW 行为符合直觉
  const updatedAtRaw = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
    ? r.updatedAt
    : Date.parse(createdAt);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  return {
    id: r.id,
    name,
    iconId,
    currency,
    totalPlayers,
    tablePlayers,
    buyIn,
    finalRank,
    prize,
    hasBounty,
    bounty,
    date: sanitizeOptionalString(r.date),
    createdAt,
    updatedAt,
    note: sanitizeOptionalString(r.note),
  };
}

function sanitizeTombstones(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

interface InternalState {
  list: Tournament[];
  /** 已删除赛事的墓碑：id → 删除时间戳。仅供云端同步使用，列表渲染会忽略。 */
  tombstones: Record<string, number>;
}

function load(): InternalState {
  if (typeof localStorage === 'undefined') return { list: [], tombstones: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { list: [], tombstones: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tournaments)) {
      return { list: [], tombstones: {} };
    }
    return {
      list: parsed.tournaments
        .map(sanitizeTournament)
        .filter((x): x is Tournament => x !== null),
      tombstones: sanitizeTombstones(parsed.tombstones),
    };
  } catch (err) {
    console.warn('[nlh-range] tournaments load failed', err);
    return { list: [], tombstones: {} };
  }
}

function save(s: InternalState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedShape = {
      version: 1,
      tournaments: s.list,
      tombstones: s.tombstones,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[nlh-range] tournaments save failed', err);
  }
}

let state: InternalState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: InternalState) {
  state = next;
  save(state);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getList(): Tournament[] {
  return state.list;
}

export function useTournaments(): Tournament[] {
  return useSyncExternalStore(subscribe, getList, getList);
}

/** 内部访问入口：sync 模块拿全量状态用。其他业务代码请用 hooks。 */
export function _getTournamentSnapshot(): InternalState {
  return state;
}

export function _setTournamentSnapshot(next: InternalState): void {
  setState(next);
}

/** 给 sync 模块用：订阅 store 任意变更。 */
export function _subscribeTournamentStore(listener: () => void): () => void {
  return subscribe(listener);
}

/** 用于新建/编辑表单收集的可写字段（不含 id / createdAt / updatedAt）。 */
export type TournamentDraft = Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>;

export const tournamentActions = {
  add(draft: TournamentDraft): string {
    const id = newId();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const next: Tournament = { ...draft, id, createdAt: nowIso, updatedAt: nowMs };
    setState({ ...state, list: [next, ...state.list] });
    return id;
  },

  update(id: string, patch: Partial<TournamentDraft>): void {
    const idx = state.list.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const cur = state.list[idx];
    const merged: Tournament = { ...cur, ...patch, updatedAt: Date.now() };
    const list = state.list.slice();
    list[idx] = merged;
    setState({ ...state, list });
  },

  remove(id: string): void {
    const list = state.list.filter((t) => t.id !== id);
    if (list.length === state.list.length) return;
    const tombstones = { ...state.tombstones, [id]: Date.now() };
    setState({ list, tombstones });
  },
};
