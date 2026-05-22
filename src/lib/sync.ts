import { useSyncExternalStore } from 'react';
import { ApiError, api, type SyncPushBody } from './api';
import {
  _getProfitPlanSnapshot,
  _setProfitPlanSnapshot,
  _subscribeProfitPlanStore,
} from '@/store/useProfitPlanStore';
import {
  _getRangePersisted,
  _replaceRangePersisted,
  _subscribeRangeStore,
} from '@/store/useRangeStore';
import {
  _getTournamentSnapshot,
  _setTournamentSnapshot,
  _subscribeTournamentStore,
} from '@/store/useTournamentStore';
import type { PersistedState, RangeDoc } from '@/store/storage';
import { sanitizeRangeDoc } from '@/store/storage';
import type { ProfitPlan } from './profitPlans';
import { isValidSeatId } from './seats';
import type { Tournament } from './tournaments';

/**
 * 客户端 ⇄ 服务端同步层。
 *
 * 模型：
 * - localStorage 是真相源（离线/匿名模式可用）。
 * - 登录后调 `pullAndMerge()`：拉服务端镜像，按行级 LWW 与本地合并，写回本地，
 *   并把所有「本地胜出」的项立即推回服务端。
 * - 之后只要本地 store 有变化，`schedulePush()` 自动 debounce 800ms 推送增量。
 * - 页面隐藏 / 关闭时 `flushPush()` 立刻把待推送的内容发出去（用 sendBeacon 兜底）。
 *
 * 防循环：sync 自己写 store 时设置 `applyingRemote = true`，store listener 回调里
 * 看到此 flag 直接跳过 schedulePush。
 *
 * 错误处理：
 * - 401 → 视为未登录，关闭自动同步，等下次 enableAutoSync 重新启用。
 * - 网络错误 → status='error'，UI 可见提示；本地数据不丢，下次 push 会重试。
 */

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  pendingPush: boolean;
}

let state: SyncState = {
  status: 'disabled',
  lastSyncedAt: null,
  error: null,
  pendingPush: false,
};

const stateListeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
}

function subscribeState(l: () => void): () => void {
  stateListeners.add(l);
  return () => {
    stateListeners.delete(l);
  };
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeState, () => state, () => state);
}

export function getSyncState(): SyncState {
  return state;
}

// ---------------------------------------------------------------------------
// 内部：增量阈值
// ---------------------------------------------------------------------------

/**
 * 上次成功 push 的时间戳（ms）。
 * 仅 `updatedAt > lastPushedHigh` 的项需要进入下一次 push 包。
 * pull 后会被刷成 `Date.now()`，因为此刻服务端已经知道我们所有本地状态。
 */
let lastPushedHigh = 0;

let applyingRemote = false;
let pushTimer: number | null = null;
let inflightPush: Promise<void> | null = null;
let unsubRange: (() => void) | null = null;
let unsubTour: (() => void) | null = null;
let unsubPlan: (() => void) | null = null;
let visListener: (() => void) | null = null;
let unloadListener: (() => void) | null = null;

const PUSH_DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// Settings payload（与 PersistedState 中偏好字段对齐）
// ---------------------------------------------------------------------------

interface SettingsPayload {
  defaultDepthLabels: string[];
  lastOpenedRangeId: string | null;
  lastOpenedDepthLabel: string | null;
  lastOpenedSeatId: string | null;
}

function settingsFromPersisted(p: PersistedState): SettingsPayload {
  return {
    defaultDepthLabels: [...p.defaultDepthLabels],
    lastOpenedRangeId: p.lastOpenedRangeId,
    lastOpenedDepthLabel: p.lastOpenedDepthLabel,
    lastOpenedSeatId: p.lastOpenedSeatId,
  };
}

function sanitizeServerSettings(raw: unknown): SettingsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const labels = Array.isArray(r.defaultDepthLabels)
    ? (r.defaultDepthLabels as unknown[]).filter((x): x is string => typeof x === 'string')
    : null;
  if (!labels) return null;
  return {
    defaultDepthLabels: labels,
    lastOpenedRangeId:
      typeof r.lastOpenedRangeId === 'string' ? r.lastOpenedRangeId : null,
    lastOpenedDepthLabel:
      typeof r.lastOpenedDepthLabel === 'string' ? r.lastOpenedDepthLabel : null,
    lastOpenedSeatId:
      typeof r.lastOpenedSeatId === 'string' && isValidSeatId(r.lastOpenedSeatId)
        ? r.lastOpenedSeatId
        : null,
  };
}

// ---------------------------------------------------------------------------
// 公共入口：启用 / 关闭自动同步
// ---------------------------------------------------------------------------

/**
 * 在 refreshAuth 拿到 authenticated 后调用一次。
 * 触发首次 pullAndMerge，并接好 store / 浏览器事件监听。
 * 重复调用会先 disable 再重启，安全幂等。
 */
export async function enableAutoSync(): Promise<void> {
  disableAutoSync();
  setState({ status: 'syncing', error: null });

  // 接好 store 监听（pull 写回时由 applyingRemote 旗标拦截，避免循环）
  unsubRange = _subscribeRangeStore(onStoreChanged);
  unsubTour = _subscribeTournamentStore(onStoreChanged);
  unsubPlan = _subscribeProfitPlanStore(onStoreChanged);

  // 页面隐藏 / 关闭前把 pending 全部冲出去
  visListener = () => {
    if (document.visibilityState === 'hidden') void flushPush();
  };
  document.addEventListener('visibilitychange', visListener);

  unloadListener = () => {
    flushPushBeacon();
  };
  window.addEventListener('beforeunload', unloadListener);
  window.addEventListener('pagehide', unloadListener);

  await pullAndMerge();
}

/**
 * 退出登录或外部主动关闭自动同步时调用。
 * 卸掉 store 订阅，把状态置回 disabled。
 */
export function disableAutoSync(): void {
  if (unsubRange) {
    unsubRange();
    unsubRange = null;
  }
  if (unsubTour) {
    unsubTour();
    unsubTour = null;
  }
  if (unsubPlan) {
    unsubPlan();
    unsubPlan = null;
  }
  if (visListener) {
    document.removeEventListener('visibilitychange', visListener);
    visListener = null;
  }
  if (unloadListener) {
    window.removeEventListener('beforeunload', unloadListener);
    window.removeEventListener('pagehide', unloadListener);
    unloadListener = null;
  }
  if (pushTimer != null) {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
  lastPushedHigh = 0;
  setState({
    status: 'disabled',
    lastSyncedAt: null,
    error: null,
    pendingPush: false,
  });
}

// ---------------------------------------------------------------------------
// Pull + LWW 合并
// ---------------------------------------------------------------------------

interface RangeSide {
  source: 'server' | 'local';
  updatedAt: number;
  deleted: boolean;
  payload: RangeDoc | null;
}

interface TourSide {
  source: 'server' | 'local';
  updatedAt: number;
  deleted: boolean;
  payload: Tournament | null;
}

interface PlanSide {
  source: 'server' | 'local';
  updatedAt: number;
  deleted: boolean;
  payload: ProfitPlan | null;
}

function pickRange(prev: RangeSide | undefined, next: RangeSide): RangeSide {
  if (!prev) return next;
  if (next.updatedAt > prev.updatedAt) return next;
  if (next.updatedAt < prev.updatedAt) return prev;
  // tie → 服务端优先，避免本地反复重推
  return next.source === 'server' ? next : prev;
}

function pickTour(prev: TourSide | undefined, next: TourSide): TourSide {
  if (!prev) return next;
  if (next.updatedAt > prev.updatedAt) return next;
  if (next.updatedAt < prev.updatedAt) return prev;
  return next.source === 'server' ? next : prev;
}

function pickPlan(prev: PlanSide | undefined, next: PlanSide): PlanSide {
  if (!prev) return next;
  if (next.updatedAt > prev.updatedAt) return next;
  if (next.updatedAt < prev.updatedAt) return prev;
  return next.source === 'server' ? next : prev;
}

export async function pullAndMerge(): Promise<void> {
  setState({ status: 'syncing', error: null });
  let pull;
  try {
    pull = await api.syncPull<RangeDoc, Tournament, SettingsPayload, ProfitPlan>();
  } catch (err) {
    handleSyncError(err);
    return;
  }

  applyingRemote = true;
  try {
    // ---- ranges ----
    const persisted = _getRangePersisted();
    const rangeMerged = new Map<string, RangeSide>();

    for (const item of pull.ranges) {
      // 服务端返回的 payload 可能是历史 v2 结构；走一遍 sanitize 升级到 v3
      const payload = item.deleted ? null : sanitizeRangeDoc(item.payload);
      rangeMerged.set(item.id, {
        source: 'server',
        updatedAt: item.updatedAt,
        deleted: item.deleted || !payload,
        payload,
      });
    }
    for (const r of persisted.ranges) {
      const cur = rangeMerged.get(r.id);
      const side: RangeSide = {
        source: 'local',
        updatedAt: r.updatedAt,
        deleted: false,
        payload: r,
      };
      rangeMerged.set(r.id, pickRange(cur, side));
    }
    for (const [id, ts] of Object.entries(persisted.rangeTombstones)) {
      const cur = rangeMerged.get(id);
      const side: RangeSide = {
        source: 'local',
        updatedAt: ts,
        deleted: true,
        payload: null,
      };
      rangeMerged.set(id, pickRange(cur, side));
    }

    const nextRanges: RangeDoc[] = [];
    const nextRangeTombstones: Record<string, number> = {};
    for (const [id, side] of rangeMerged) {
      if (side.deleted || !side.payload) {
        nextRangeTombstones[id] = side.updatedAt;
      } else {
        nextRanges.push(side.payload);
      }
    }

    // ---- settings ----
    let nextSettingsPayload = settingsFromPersisted(persisted);
    let nextSettingsAt = persisted.settingsUpdatedAt;
    if (pull.settings) {
      const remote = sanitizeServerSettings(pull.settings.payload);
      if (remote && pull.settings.updatedAt > nextSettingsAt) {
        nextSettingsPayload = remote;
        nextSettingsAt = pull.settings.updatedAt;
      }
    }

    const nextPersisted: PersistedState = {
      ...persisted,
      ranges: nextRanges,
      rangeTombstones: nextRangeTombstones,
      defaultDepthLabels: nextSettingsPayload.defaultDepthLabels,
      lastOpenedRangeId: nextSettingsPayload.lastOpenedRangeId,
      lastOpenedDepthLabel: nextSettingsPayload.lastOpenedDepthLabel,
      lastOpenedSeatId: nextSettingsPayload.lastOpenedSeatId,
      settingsUpdatedAt: nextSettingsAt,
    };
    _replaceRangePersisted(nextPersisted);

    // ---- tournaments ----
    const tourState = _getTournamentSnapshot();
    const tourMerged = new Map<string, TourSide>();

    for (const item of pull.tournaments) {
      tourMerged.set(item.id, {
        source: 'server',
        updatedAt: item.updatedAt,
        deleted: item.deleted,
        payload: item.deleted ? null : (item.payload as Tournament | null),
      });
    }
    for (const t of tourState.list) {
      const cur = tourMerged.get(t.id);
      tourMerged.set(
        t.id,
        pickTour(cur, {
          source: 'local',
          updatedAt: t.updatedAt,
          deleted: false,
          payload: t,
        }),
      );
    }
    for (const [id, ts] of Object.entries(tourState.tombstones)) {
      const cur = tourMerged.get(id);
      tourMerged.set(
        id,
        pickTour(cur, { source: 'local', updatedAt: ts, deleted: true, payload: null }),
      );
    }

    const nextTourList: Tournament[] = [];
    const nextTourTombstones: Record<string, number> = {};
    for (const [id, side] of tourMerged) {
      if (side.deleted || !side.payload) {
        nextTourTombstones[id] = side.updatedAt;
      } else {
        nextTourList.push(side.payload);
      }
    }
    _setTournamentSnapshot({ list: nextTourList, tombstones: nextTourTombstones });

    // ---- plans ----
    const planState = _getProfitPlanSnapshot();
    const planMerged = new Map<string, PlanSide>();

    for (const item of pull.plans) {
      planMerged.set(item.id, {
        source: 'server',
        updatedAt: item.updatedAt,
        deleted: item.deleted,
        payload: item.deleted ? null : (item.payload as ProfitPlan | null),
      });
    }
    for (const p of planState.list) {
      const cur = planMerged.get(p.id);
      planMerged.set(
        p.id,
        pickPlan(cur, {
          source: 'local',
          updatedAt: p.updatedAt,
          deleted: false,
          payload: p,
        }),
      );
    }
    for (const [id, ts] of Object.entries(planState.tombstones)) {
      const cur = planMerged.get(id);
      planMerged.set(
        id,
        pickPlan(cur, { source: 'local', updatedAt: ts, deleted: true, payload: null }),
      );
    }

    const nextPlanList: ProfitPlan[] = [];
    const nextPlanTombstones: Record<string, number> = {};
    for (const [id, side] of planMerged) {
      if (side.deleted || !side.payload) {
        nextPlanTombstones[id] = side.updatedAt;
      } else {
        nextPlanList.push(side.payload);
      }
    }
    _setProfitPlanSnapshot({ list: nextPlanList, tombstones: nextPlanTombstones });
  } finally {
    applyingRemote = false;
  }

  // pull 完成 → lastPushedHigh 重置成 0：让接下来的 push 把本地凡是「比服务端新或服务端没有」
  // 的项一次性推上去。LWW 保证服务端不会被旧版本覆盖。
  lastPushedHigh = 0;
  setState({
    status: 'idle',
    error: null,
    lastSyncedAt: Date.now(),
    pendingPush: hasPendingChanges(),
  });

  // 立即 push 本次合并后本地胜出的部分
  schedulePush(0);
}

// ---------------------------------------------------------------------------
// Push（debounce）
// ---------------------------------------------------------------------------

function onStoreChanged() {
  if (applyingRemote) return;
  if (state.status === 'disabled') return;
  schedulePush();
}

export function schedulePush(delayMs: number = PUSH_DEBOUNCE_MS): void {
  if (state.status === 'disabled') return;
  setState({ pendingPush: true });
  if (pushTimer != null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void runPush();
  }, delayMs);
}

export async function flushPush(): Promise<void> {
  if (pushTimer != null) {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (state.status === 'disabled') return;
  await runPush();
}

type PushBody = SyncPushBody<RangeDoc, Tournament, SettingsPayload, ProfitPlan>;

function buildPushBody(threshold: number): PushBody {
  const persisted = _getRangePersisted();
  const tour = _getTournamentSnapshot();
  const plan = _getProfitPlanSnapshot();

  const ranges: PushBody['ranges'] = [];
  for (const r of persisted.ranges) {
    if (r.updatedAt > threshold) {
      ranges.push({ id: r.id, updatedAt: r.updatedAt, deleted: false, payload: r });
    }
  }
  for (const [id, ts] of Object.entries(persisted.rangeTombstones)) {
    if (ts > threshold) {
      ranges.push({ id, updatedAt: ts, deleted: true });
    }
  }

  const tournaments: PushBody['tournaments'] = [];
  for (const t of tour.list) {
    if (t.updatedAt > threshold) {
      tournaments.push({ id: t.id, updatedAt: t.updatedAt, deleted: false, payload: t });
    }
  }
  for (const [id, ts] of Object.entries(tour.tombstones)) {
    if (ts > threshold) {
      tournaments.push({ id, updatedAt: ts, deleted: true });
    }
  }

  const plans: PushBody['plans'] = [];
  for (const p of plan.list) {
    if (p.updatedAt > threshold) {
      plans.push({ id: p.id, updatedAt: p.updatedAt, deleted: false, payload: p });
    }
  }
  for (const [id, ts] of Object.entries(plan.tombstones)) {
    if (ts > threshold) {
      plans.push({ id, updatedAt: ts, deleted: true });
    }
  }

  const body: PushBody = {};
  if (ranges.length) body.ranges = ranges;
  if (tournaments.length) body.tournaments = tournaments;
  if (plans.length) body.plans = plans;
  if (persisted.settingsUpdatedAt > threshold) {
    body.settings = {
      payload: settingsFromPersisted(persisted),
      updatedAt: persisted.settingsUpdatedAt,
    };
  }
  return body;
}

function bodyHasContent(body: PushBody): boolean {
  return (
    !!body.ranges?.length ||
    !!body.tournaments?.length ||
    !!body.plans?.length ||
    !!body.settings
  );
}

async function runPush(): Promise<void> {
  if (inflightPush) {
    await inflightPush;
    // 期间可能又有变更，递归一次让最新数据出去
    if (hasPendingChanges()) {
      schedulePush(0);
    }
    return;
  }
  const body = buildPushBody(lastPushedHigh);
  if (!bodyHasContent(body)) {
    setState({ pendingPush: false });
    return;
  }

  setState({ status: 'syncing', error: null });
  const startedAt = Date.now();

  inflightPush = (async () => {
    try {
      await api.syncPush(body);
      lastPushedHigh = startedAt;
      setState({
        status: 'idle',
        error: null,
        lastSyncedAt: Date.now(),
        pendingPush: hasPendingChanges(),
      });
    } catch (err) {
      handleSyncError(err);
    } finally {
      inflightPush = null;
    }
  })();
  await inflightPush;
}

function hasPendingChanges(): boolean {
  return bodyHasContent(buildPushBody(lastPushedHigh));
}

function handleSyncError(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) {
    // session 已失效；交由 useAuthStore 的 401 处理走重新登录流程
    disableAutoSync();
    return;
  }
  const msg = err instanceof Error ? err.message : 'sync failed';
  setState({ status: 'error', error: msg });
}

/**
 * 关闭/隐藏页面时用 sendBeacon 把待推送数据兜底发出去。
 * sendBeacon 不带 cookies 默认会发，body 必须是 Blob/FormData，
 * 这里序列化成 application/json blob。
 */
function flushPushBeacon(): void {
  if (state.status === 'disabled') return;
  const body = buildPushBody(lastPushedHigh);
  if (!bodyHasContent(body)) return;
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    const apiBase = import.meta.env.VITE_API_BASE ?? '';
    navigator.sendBeacon(`${apiBase}/api/sync/push`, blob);
    lastPushedHigh = Date.now();
  } catch {
    // 忽略：sendBeacon 不支持时退而求其次靠正常 push
  }
}
