import { useSyncExternalStore } from 'react';
import type { ProfitPlan } from '@/lib/profitPlans';
import { newId } from './storage';

/**
 * 主要盈利计划 store。
 *
 * 设计风格对齐 useTournamentStore：vanilla store + useSyncExternalStore，
 * localStorage 持久化。本期不接入云同步；但仍预留 `_get/_set/_subscribe` 内部接口，
 * 后续按 tournaments 同款 LWW 接入 sync.ts 时无需调整调用方。
 */

const STORAGE_KEY = 'nlh:profit-plans:v1';

interface PersistedShape {
  version: 1;
  plans: ProfitPlan[];
  /** 预留：与 tournaments tombstones 等价，本期未使用。 */
  tombstones?: Record<string, number>;
}

function sanitizeNumber(v: unknown, fallback = 0): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v;
}

function sanitizeDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function sanitizeOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function sanitizePlan(raw: unknown): ProfitPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const startDate = sanitizeDate(r.startDate);
  const endDate = sanitizeDate(r.endDate);
  if (!startDate || !endDate) return null;
  if (endDate < startDate) return null;
  const targetUSD = sanitizeNumber(r.targetUSD, 0);
  const createdAt =
    typeof r.createdAt === 'string' && r.createdAt
      ? r.createdAt
      : new Date().toISOString();
  const updatedAtRaw =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
      ? r.updatedAt
      : Date.parse(createdAt);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  return {
    id: r.id,
    name: sanitizeOptionalString(r.name),
    startDate,
    endDate,
    targetUSD,
    note: sanitizeOptionalString(r.note),
    createdAt,
    updatedAt,
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
  list: ProfitPlan[];
  tombstones: Record<string, number>;
}

function load(): InternalState {
  if (typeof localStorage === 'undefined') return { list: [], tombstones: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { list: [], tombstones: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.plans)) {
      return { list: [], tombstones: {} };
    }
    return {
      list: parsed.plans
        .map(sanitizePlan)
        .filter((x): x is ProfitPlan => x !== null),
      tombstones: sanitizeTombstones(parsed.tombstones),
    };
  } catch (err) {
    console.warn('[nlh-range] profit-plans load failed', err);
    return { list: [], tombstones: {} };
  }
}

function save(s: InternalState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedShape = {
      version: 1,
      plans: s.list,
      tombstones: s.tombstones,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[nlh-range] profit-plans save failed', err);
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

/** 排序：按 startDate 升序；相同时按 createdAt 升序。 */
function sortPlans(list: ProfitPlan[]): ProfitPlan[] {
  return [...list].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function getSortedList(): ProfitPlan[] {
  return sortedCache.list === state.list ? sortedCache.sorted : refreshCache();
}

// 简易缓存：避免每次 useSyncExternalStore 调用都重新排序导致引用变更
const sortedCache: { list: ProfitPlan[]; sorted: ProfitPlan[] } = {
  list: [],
  sorted: [],
};

function refreshCache(): ProfitPlan[] {
  sortedCache.list = state.list;
  sortedCache.sorted = sortPlans(state.list);
  return sortedCache.sorted;
}

export function useProfitPlans(): ProfitPlan[] {
  return useSyncExternalStore(subscribe, getSortedList, getSortedList);
}

/** 给后续 sync 模块用：拿全量内部状态。 */
export function _getProfitPlanSnapshot(): InternalState {
  return state;
}

export function _setProfitPlanSnapshot(next: InternalState): void {
  setState(next);
}

export function _subscribeProfitPlanStore(listener: () => void): () => void {
  return subscribe(listener);
}

/** 表单写入用字段（不含 id / createdAt / updatedAt）。 */
export type ProfitPlanDraft = Omit<ProfitPlan, 'id' | 'createdAt' | 'updatedAt'>;

export const profitPlanActions = {
  add(draft: ProfitPlanDraft): string {
    const id = newId();
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const next: ProfitPlan = {
      ...draft,
      id,
      createdAt: nowIso,
      updatedAt: nowMs,
    };
    setState({ ...state, list: [next, ...state.list] });
    return id;
  },

  update(id: string, patch: Partial<ProfitPlanDraft>): void {
    const idx = state.list.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const cur = state.list[idx];
    const merged: ProfitPlan = { ...cur, ...patch, updatedAt: Date.now() };
    const list = state.list.slice();
    list[idx] = merged;
    setState({ ...state, list });
  },

  remove(id: string): void {
    const list = state.list.filter((p) => p.id !== id);
    if (list.length === state.list.length) return;
    const tombstones = { ...state.tombstones, [id]: Date.now() };
    setState({ list, tombstones });
  },
};
