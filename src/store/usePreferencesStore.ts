import { useSyncExternalStore } from 'react';

/**
 * 本地偏好设置 store：仅本机持久化（localStorage），暂不参与云同步。
 * 风格对齐 useTournamentStore：vanilla store + useSyncExternalStore。
 *
 * 当前覆盖：
 * - showTournamentStats：首页是否显示比赛统计卡片（总奖金 / 总比赛 / ROI / ITM）
 * - showProfitChart：首页是否显示比赛盈亏曲线
 */

const STORAGE_KEY = 'nlh:preferences:v1';

export interface Preferences {
  showTournamentStats: boolean;
  showProfitChart: boolean;
}

const DEFAULTS: Preferences = {
  showTournamentStats: true,
  showProfitChart: true,
};

interface PersistedShape {
  version: 1;
  preferences: Partial<Preferences>;
}

function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const r = raw as Partial<Preferences>;
  return {
    showTournamentStats:
      typeof r.showTournamentStats === 'boolean'
        ? r.showTournamentStats
        : DEFAULTS.showTournamentStats,
    showProfitChart:
      typeof r.showProfitChart === 'boolean' ? r.showProfitChart : DEFAULTS.showProfitChart,
  };
}

function load(): Preferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || parsed.version !== 1) return { ...DEFAULTS };
    return sanitize(parsed.preferences);
  } catch (err) {
    console.warn('[nlh-range] preferences load failed', err);
    return { ...DEFAULTS };
  }
}

function save(s: Preferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedShape = { version: 1, preferences: s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[nlh-range] preferences save failed', err);
  }
}

let state: Preferences = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): Preferences {
  return state;
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const preferenceActions = {
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    if (state[key] === value) return;
    state = { ...state, [key]: value };
    save(state);
    emit();
  },
  toggle(key: keyof Preferences): void {
    state = { ...state, [key]: !state[key] };
    save(state);
    emit();
  },
};
