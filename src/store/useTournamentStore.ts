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
  // 允许空字符串：表示「未选择图标」，列表渲染时跳过 icon 单元格
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
    note: sanitizeOptionalString(r.note),
  };
}

function load(): Tournament[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tournaments)) return [];
    return parsed.tournaments
      .map(sanitizeTournament)
      .filter((x): x is Tournament => x !== null);
  } catch (err) {
    console.warn('[nlh-range] tournaments load failed', err);
    return [];
  }
}

function save(list: Tournament[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedShape = { version: 1, tournaments: list };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[nlh-range] tournaments save failed', err);
  }
}

let state: Tournament[] = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: Tournament[]) {
  state = next;
  save(state);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Tournament[] {
  return state;
}

export function useTournaments(): Tournament[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 用于新建/编辑表单收集的可写字段（不含 id / createdAt）。 */
export type TournamentDraft = Omit<Tournament, 'id' | 'createdAt'>;

export const tournamentActions = {
  add(draft: TournamentDraft): string {
    const id = newId();
    const now = new Date().toISOString();
    const next: Tournament = { ...draft, id, createdAt: now };
    setState([next, ...state]);
    return id;
  },

  update(id: string, patch: Partial<TournamentDraft>): void {
    const idx = state.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const cur = state[idx];
    const merged: Tournament = { ...cur, ...patch };
    const next = state.slice();
    next[idx] = merged;
    setState(next);
  },

  remove(id: string): void {
    const next = state.filter((t) => t.id !== id);
    if (next.length === state.length) return;
    setState(next);
  },
};
