import { useSyncExternalStore } from 'react';
import type { Action, CustomAction } from '@/lib/colors';
import { newCustomActionId } from '@/lib/colors';
import { ALL_HAND_KEYS } from '@/lib/hands';
import {
  DEFAULT_DEPTH_LABELS,
  bucketCellsFor,
  type DepthGrid,
  type SeatBucket,
} from '@/lib/depths';
import { seatsForCount, type SeatId } from '@/lib/seats';
import {
  clampSeats,
  DEFAULT_SEATS,
  loadState,
  makeRange,
  newId,
  saveState,
  type PersistedState,
  type RangeDoc,
} from './storage';

/**
 * 工作区（draft）：当前选中范围的整套深度副本。
 * - 涂色 / 编辑深度操作均在 draft 上发生，dirty=true。
 * - 显式 save 时把整个 draft 写回 persisted.ranges 对应 id。
 * - 没有选中范围时 rangeId=null，网格显示空白只读态。
 *
 * 三个维度：
 * - currentDepthLabel：筹码深度
 * - currentSeatId：英雄座位
 * - currentOpponentId：对战座位（null = 总体，未指定具体对战）
 *
 * 编辑模式（§3.8）：
 * - editing=false 时网格的单格涂色（paintCell）不会改动 cells。
 * - beginEdit() 拍下当前激活 (depth, seat, opp) 对应那张表的 cells 快照；
 *   confirmEdit() 退出编辑模式但保留涂色；
 *   cancelEdit() 把快照写回，并按 wasIndependent 决定是否把已分叉的对战表回滚为「跟随总体」。
 *
 * COW 分叉（对战座位）：
 * - 当 currentOpponentId != null 且 bucket.vs[opp] 不存在时，第一笔涂色会先把 overall
 *   浅拷贝到 vs[opp]（独立化），再写入；之后 vs[opp] 与 overall 彻底独立。
 */
export interface EditSnapshot {
  depthLabel: string;
  seatId: string;
  opponentId: string | null;
  /** 进入编辑前那张目标表（overall 或 vs[opp]）的内容快照。 */
  cells: Record<string, Action>;
  /**
   * 进入编辑时该对战是否已独立。
   * - opponentId == null：总体永远视为「独立」，固定 true。
   * - opponentId != null 且 vs[opp] 当时存在 → true，cancel 写回 vs[opp]。
   * - opponentId != null 且 vs[opp] 当时不存在 → false，cancel 删除 vs[opp]，回到跟随。
   */
  wasIndependent: boolean;
}

export interface DraftState {
  rangeId: string | null;
  name: string;
  seats: number;
  depths: DepthGrid[];
  /** 当前 range 的自定义动作集合，跟随 range 一同存盘。 */
  customActions: CustomAction[];
  currentDepthLabel: string | null;
  currentSeatId: string | null;
  currentOpponentId: string | null;
  dirty: boolean;
  editing: boolean;
  editSnapshot: EditSnapshot | null;
}

interface InternalState {
  persisted: PersistedState;
  draft: DraftState;
}

const EMPTY_DRAFT: DraftState = {
  rangeId: null,
  name: '',
  seats: DEFAULT_SEATS,
  depths: [],
  customActions: [],
  currentDepthLabel: null,
  currentSeatId: null,
  currentOpponentId: null,
  dirty: false,
  editing: false,
  editSnapshot: null,
};

const DEFAULT_SEAT_ID: SeatId = 'UTG';

function pickInitialSeat(
  seatsCount: number,
  preferred: string | null | undefined,
): SeatId {
  const order = seatsForCount(seatsCount);
  if (preferred && (order as readonly string[]).includes(preferred)) {
    return preferred as SeatId;
  }
  if ((order as readonly string[]).includes(DEFAULT_SEAT_ID)) {
    return DEFAULT_SEAT_ID;
  }
  return order[0] as SeatId;
}

function pickInitialOpponent(
  seatsCount: number,
  heroSeatId: string,
  preferred: string | null | undefined,
): string | null {
  if (!preferred) return null;
  if (preferred === heroSeatId) return null;
  const order = seatsForCount(seatsCount);
  if (!(order as readonly string[]).includes(preferred)) return null;
  return preferred;
}

function draftFromRange(
  range: RangeDoc,
  preferLabel: string | null,
  preferSeatId: string | null,
  preferOpponentId: string | null,
): DraftState {
  const depths = range.depths.map(cloneDepth);
  const label =
    preferLabel && depths.some((d) => d.label === preferLabel)
      ? preferLabel
      : depths[0]?.label ?? null;
  const seatsCount = clampSeats(range.seats);
  const seatId = pickInitialSeat(seatsCount, preferSeatId);
  const opponentId = pickInitialOpponent(seatsCount, seatId, preferOpponentId);
  return {
    rangeId: range.id,
    name: range.name,
    seats: seatsCount,
    depths,
    customActions: (range.customActions ?? []).map((c) => ({ ...c })),
    currentDepthLabel: label,
    currentSeatId: seatId,
    currentOpponentId: opponentId,
    dirty: false,
    editing: false,
    editSnapshot: null,
  };
}

function cloneBucket(b: SeatBucket): SeatBucket {
  const vs: Record<string, Record<string, Action>> = {};
  for (const [k, v] of Object.entries(b.vs)) vs[k] = { ...v };
  return { overall: { ...b.overall }, vs };
}

function cloneSeatsMap(
  seatsMap: Record<string, SeatBucket>,
): Record<string, SeatBucket> {
  const out: Record<string, SeatBucket> = {};
  for (const [k, v] of Object.entries(seatsMap)) out[k] = cloneBucket(v);
  return out;
}

function cloneDepth(d: DepthGrid): DepthGrid {
  return { label: d.label, seats: cloneSeatsMap(d.seats) };
}

function cellsEqual(a: Record<string, Action>, b: Record<string, Action>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function bucketsEqual(a: SeatBucket, b: SeatBucket): boolean {
  if (!cellsEqual(a.overall, b.overall)) return false;
  const ka = Object.keys(a.vs);
  const kb = Object.keys(b.vs);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = a.vs[k];
    const bv = b.vs[k];
    if (!bv) return false;
    if (!cellsEqual(av, bv)) return false;
  }
  return true;
}

function seatsMapEqual(
  a: Record<string, SeatBucket>,
  b: Record<string, SeatBucket>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = a[k];
    const bv = b[k];
    if (!bv) return false;
    if (!bucketsEqual(av, bv)) return false;
  }
  return true;
}

function customActionsEqual(a: CustomAction[], b: CustomAction[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].label !== b[i].label) return false;
    if (a[i].color !== b[i].color) return false;
  }
  return true;
}

function draftMatchesPersisted(draft: DraftState, persisted: PersistedState): boolean {
  if (!draft.rangeId) return true;
  const src = persisted.ranges.find((r) => r.id === draft.rangeId);
  if (!src) return false;
  if (src.name !== draft.name) return false;
  if (src.seats !== draft.seats) return false;
  if (!customActionsEqual(src.customActions ?? [], draft.customActions)) return false;
  if (src.depths.length !== draft.depths.length) return false;
  for (let i = 0; i < src.depths.length; i++) {
    const a = src.depths[i];
    const b = draft.depths[i];
    if (a.label !== b.label) return false;
    if (!seatsMapEqual(a.seats, b.seats)) return false;
  }
  return true;
}

function buildInitialState(): InternalState {
  const persisted = loadState();
  const target = persisted.lastOpenedRangeId
    ? persisted.ranges.find((r) => r.id === persisted.lastOpenedRangeId)
    : undefined;
  const draft = target
    ? draftFromRange(
        target,
        persisted.lastOpenedDepthLabel,
        persisted.lastOpenedSeatId,
        persisted.lastOpenedOpponentId,
      )
    : { ...EMPTY_DRAFT };
  return { persisted, draft };
}

let state: InternalState = buildInitialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(updater: (s: InternalState) => InternalState) {
  state = updater(state);
  saveState(state.persisted);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): InternalState {
  return state;
}

// -------------------- Selector hooks --------------------

export function useDraft(): DraftState {
  return useSyncExternalStore(subscribe, () => getSnapshot().draft, () => getSnapshot().draft);
}

export function useRanges(): RangeDoc[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().persisted.ranges,
    () => getSnapshot().persisted.ranges,
  );
}

export function useRangesSorted(): RangeDoc[] {
  const all = useRanges();
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useDefaultDepthLabels(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().persisted.defaultDepthLabels,
    () => getSnapshot().persisted.defaultDepthLabels,
  );
}

export function useCustomActions(): CustomAction[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().draft.customActions,
    () => getSnapshot().draft.customActions,
  );
}

export const EMPTY_CELLS: Record<string, Action> = Object.freeze({});

/** 取当前 (depth, hero) 对应的 SeatBucket（不存在则 undefined）。 */
export function getCurrentBucket(draft: DraftState): SeatBucket | undefined {
  if (!draft.currentDepthLabel || !draft.currentSeatId) return undefined;
  const depth = draft.depths.find((x) => x.label === draft.currentDepthLabel);
  if (!depth) return undefined;
  return depth.seats[draft.currentSeatId];
}

/** 取当前 (depth, hero, opp) 应渲染的 cells（按 opp 派发；未独立则回退到 overall）。 */
export function getCurrentCells(draft: DraftState): Record<string, Action> {
  const bucket = getCurrentBucket(draft);
  if (!bucket) return EMPTY_CELLS;
  return bucketCellsFor(bucket, draft.currentOpponentId);
}

/** 兼容旧引用名。 */
export const getCurrentSeatCells = getCurrentCells;
export const getCurrentDepthCells = getCurrentCells;

// -------------------- Internal helpers --------------------

/**
 * 在当前激活 (depth, hero) 的 SeatBucket 上做变更并把结果写回 draft。
 * mutator 接收当前 bucket（若不存在则给 { overall:{}, vs:{} }），返回新的 bucket。
 * 若新 bucket 与旧 bucket 引用相同则视作未变更，draft 不变。
 * 若新 bucket 完全空（overall 空且 vs 无任何 key）则把 seats[heroSeat] 删除。
 */
function withBucketChange(
  draft: DraftState,
  mutator: (bucket: SeatBucket) => SeatBucket,
): DraftState {
  if (!draft.currentDepthLabel || !draft.currentSeatId) return draft;
  const dIdx = draft.depths.findIndex((d) => d.label === draft.currentDepthLabel);
  if (dIdx < 0) return draft;
  const depth = draft.depths[dIdx];
  const seatId = draft.currentSeatId;
  const cur = depth.seats[seatId] ?? { overall: {}, vs: {} };
  const next = mutator(cur);
  if (next === cur) return draft;
  const isEmpty =
    Object.keys(next.overall).length === 0 && Object.keys(next.vs).length === 0;
  const nextSeats = { ...depth.seats };
  if (isEmpty) {
    delete nextSeats[seatId];
  } else {
    nextSeats[seatId] = next;
  }
  const depths = draft.depths.slice();
  depths[dIdx] = { label: depth.label, seats: nextSeats };
  return { ...draft, depths, dirty: true };
}

function bumpLastOpened(draft: DraftState, persisted: PersistedState): PersistedState {
  return {
    ...persisted,
    lastOpenedRangeId: draft.rangeId,
    lastOpenedDepthLabel: draft.currentDepthLabel,
    lastOpenedSeatId: draft.currentSeatId,
    lastOpenedOpponentId: draft.currentOpponentId,
  };
}

// -------------------- 编辑模式辅助 --------------------

/**
 * 把编辑模式的 snapshot 应用回当前 (depth, seat, opp) 的 cells，并清除 editing/editSnapshot。
 * 如果回滚后 draft 与 persisted 完全一致，则同时清除 dirty 标记。
 * 没有进入编辑模式 / 没有 snapshot / 没激活范围时直接返回原 draft。
 */
function rollbackEditing(draft: DraftState, persisted: PersistedState): DraftState {
  if (!draft.editing && !draft.editSnapshot) return draft;
  const snap = draft.editSnapshot;
  let depths = draft.depths;
  if (snap) {
    const dIdx = depths.findIndex((d) => d.label === snap.depthLabel);
    if (dIdx >= 0) {
      const depth = depths[dIdx];
      const bucket = depth.seats[snap.seatId] ?? { overall: {}, vs: {} };
      let nextBucket: SeatBucket;
      if (snap.opponentId == null) {
        // 总体回滚
        nextBucket = { overall: { ...snap.cells }, vs: { ...bucket.vs } };
      } else if (snap.wasIndependent) {
        // 之前已独立 → 把快照写回 vs[opp]
        nextBucket = {
          overall: bucket.overall,
          vs: { ...bucket.vs, [snap.opponentId]: { ...snap.cells } },
        };
      } else {
        // 之前未独立 → 删除 vs[opp]，回到「跟随总体」状态
        const vs = { ...bucket.vs };
        delete vs[snap.opponentId];
        nextBucket = { overall: bucket.overall, vs };
      }
      const isEmpty =
        Object.keys(nextBucket.overall).length === 0 &&
        Object.keys(nextBucket.vs).length === 0;
      const nextSeats = { ...depth.seats };
      if (isEmpty) {
        delete nextSeats[snap.seatId];
      } else {
        nextSeats[snap.seatId] = nextBucket;
      }
      const next = depths.slice();
      next[dIdx] = { label: depth.label, seats: nextSeats };
      depths = next;
    }
  }
  const rolled: DraftState = {
    ...draft,
    depths,
    editing: false,
    editSnapshot: null,
  };
  const dirty = rolled.rangeId ? !draftMatchesPersisted(rolled, persisted) : false;
  return { ...rolled, dirty };
}

/** 退出编辑模式但保留涂色（dirty 不变）。 */
function commitEditing(draft: DraftState): DraftState {
  if (!draft.editing && !draft.editSnapshot) return draft;
  return { ...draft, editing: false, editSnapshot: null };
}

// -------------------- Actions --------------------

export const rangeActions = {
  // ====== 编辑模式开关 ======
  beginEdit() {
    setState((s) => {
      const d = s.draft;
      if (!d.rangeId || !d.currentDepthLabel || !d.currentSeatId) return s;
      if (d.editing) return s;
      const depth = d.depths.find((x) => x.label === d.currentDepthLabel);
      if (!depth) return s;
      const bucket = depth.seats[d.currentSeatId] ?? { overall: {}, vs: {} };
      const opp = d.currentOpponentId;
      let cells: Record<string, Action>;
      let wasIndependent: boolean;
      if (opp == null) {
        cells = { ...bucket.overall };
        wasIndependent = true;
      } else if (Object.prototype.hasOwnProperty.call(bucket.vs, opp)) {
        cells = { ...bucket.vs[opp] };
        wasIndependent = true;
      } else {
        // 当前对战未独立：快照存的是当时显示中的 overall，wasIndependent=false
        // 用于 cancel 时让 vs[opp] 重新消失（恢复跟随）。
        cells = { ...bucket.overall };
        wasIndependent = false;
      }
      const editSnapshot: EditSnapshot = {
        depthLabel: depth.label,
        seatId: d.currentSeatId,
        opponentId: opp,
        cells,
        wasIndependent,
      };
      return { ...s, draft: { ...d, editing: true, editSnapshot } };
    });
  },

  confirmEdit() {
    setState((s) => {
      const next = commitEditing(s.draft);
      if (next === s.draft) return s;
      return { ...s, draft: next };
    });
  },

  cancelEdit() {
    setState((s) => {
      const next = rollbackEditing(s.draft, s.persisted);
      if (next === s.draft) return s;
      return { ...s, draft: next };
    });
  },

  // ====== 涂色 ======
  paintCell(hand: string, action: Action) {
    setState((s) => {
      if (!s.draft.editing) return s;
      const opp = s.draft.currentOpponentId;
      const draft = withBucketChange(s.draft, (bucket) => {
        if (opp == null) {
          const prev = bucket.overall[hand] ?? 'fold';
          if (prev === action) return bucket;
          const overall = { ...bucket.overall };
          if (action === 'fold') delete overall[hand];
          else overall[hand] = action;
          return { overall, vs: bucket.vs };
        }
        const existing = bucket.vs[opp];
        const base = existing ?? bucket.overall;
        const prev = base[hand] ?? 'fold';
        // 即使要求 fork（首次写未独立的对战），如果用户点的颜色和当前显示完全一致，
        // 视觉上没有变化，不做任何修改，避免无意义地分叉出独立表。
        if (prev === action) return bucket;
        const next = { ...base };
        if (action === 'fold') delete next[hand];
        else next[hand] = action;
        return { overall: bucket.overall, vs: { ...bucket.vs, [opp]: next } };
      });
      if (draft === s.draft) return s;
      return { ...s, draft };
    });
  },

  fillAll(action: Action) {
    setState((s) => {
      const opp = s.draft.currentOpponentId;
      const draft = withBucketChange(s.draft, (bucket) => {
        const target: Record<string, Action> = {};
        if (action !== 'fold') {
          for (const k of ALL_HAND_KEYS) target[k] = action;
        }
        if (opp == null) {
          // 总体：直接覆盖 overall
          if (cellsEqual(bucket.overall, target)) return bucket;
          return { overall: target, vs: bucket.vs };
        }
        // 对战：写到 vs[opp]，必要时分叉
        const existing = bucket.vs[opp];
        if (existing && cellsEqual(existing, target)) return bucket;
        // 未独立 + 总体本身就等于 target + 用户要清空(fold) → 跟随更省事
        if (!existing && cellsEqual(bucket.overall, target)) return bucket;
        return {
          overall: bucket.overall,
          vs: { ...bucket.vs, [opp]: target },
        };
      });
      if (draft === s.draft) return s;
      return { ...s, draft };
    });
  },

  clearAll() {
    this.fillAll('fold');
  },

  /**
   * 让某个对战座位「恢复跟随总体」状态（删除 vs[opp]）。
   * 仅在当前激活 (depth, hero) 上操作，dirty=true。
   */
  resetOpponent(opponentId: string) {
    setState((s) => {
      const draft = withBucketChange(s.draft, (bucket) => {
        if (!Object.prototype.hasOwnProperty.call(bucket.vs, opponentId)) return bucket;
        const vs = { ...bucket.vs };
        delete vs[opponentId];
        return { overall: bucket.overall, vs };
      });
      if (draft === s.draft) return s;
      return { ...s, draft };
    });
  },

  // ====== Draft 元数据 ======
  setName(name: string) {
    setState((s) => {
      if (!s.draft.rangeId) return s;
      if (s.draft.name === name) return s;
      return { ...s, draft: { ...s.draft, name, dirty: true } };
    });
  },

  setSeats(seats: number) {
    const next = clampSeats(seats);
    setState((s) => {
      if (!s.draft.rangeId) return s;
      if (s.draft.seats === next) return s;
      const order = seatsForCount(next);
      const validSeat =
        s.draft.currentSeatId && (order as readonly string[]).includes(s.draft.currentSeatId)
          ? s.draft.currentSeatId
          : order[0];
      // opponent 若不在新序列里 / 等于新 hero → 回到「总体」
      const validOpp =
        s.draft.currentOpponentId &&
        (order as readonly string[]).includes(s.draft.currentOpponentId) &&
        s.draft.currentOpponentId !== validSeat
          ? s.draft.currentOpponentId
          : null;
      return {
        ...s,
        draft: {
          ...s.draft,
          seats: next,
          currentSeatId: validSeat,
          currentOpponentId: validOpp,
          dirty: true,
        },
      };
    });
  },

  // ====== Depth / Seat / Opponent 切换 ======
  switchDepth(label: string) {
    setState((s) => {
      if (s.draft.currentDepthLabel === label) return s;
      if (!s.draft.depths.some((d) => d.label === label)) return s;
      const base = rollbackEditing(s.draft, s.persisted);
      const draft: DraftState = { ...base, currentDepthLabel: label };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  switchSeat(seatId: string) {
    setState((s) => {
      if (s.draft.currentSeatId === seatId) return s;
      const order = seatsForCount(s.draft.seats);
      if (!(order as readonly string[]).includes(seatId)) return s;
      const base = rollbackEditing(s.draft, s.persisted);
      // 切换英雄座位时，对战自动回到「总体」（语义跟随英雄）
      const draft: DraftState = {
        ...base,
        currentSeatId: seatId,
        currentOpponentId: null,
      };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 切换对战座位。null = 回到「总体」。
   * - 不能选英雄自己。
   * - 必须落在当前桌人数对应的座位序列里。
   * - 编辑模式下先按「取消」回滚再切换。
   */
  switchOpponent(opponentId: string | null) {
    setState((s) => {
      if (s.draft.currentOpponentId === opponentId) return s;
      if (opponentId !== null) {
        if (opponentId === s.draft.currentSeatId) return s;
        const order = seatsForCount(s.draft.seats);
        if (!(order as readonly string[]).includes(opponentId)) return s;
      }
      const base = rollbackEditing(s.draft, s.persisted);
      const draft: DraftState = { ...base, currentOpponentId: opponentId };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 把 draft.depths 替换为新数组（深度编辑弹窗"应用"时调用）。
   * - 必须保证每个 label 唯一（调用方校验）
   * - 若 saveAsDefault=true，写入 persisted.defaultDepthLabels
   * - currentDepthLabel 若已不存在，回退到第一个 depth
   */
  applyDepthEdits(newDepths: DepthGrid[], saveAsDefault: boolean) {
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const base = commitEditing(s.draft);
      const depths = newDepths.map(cloneDepth);
      const stillHas = depths.some((d) => d.label === base.currentDepthLabel);
      const draft: DraftState = {
        ...base,
        depths,
        currentDepthLabel: stillHas ? base.currentDepthLabel : depths[0]?.label ?? null,
        dirty: true,
      };
      let persisted = s.persisted;
      if (saveAsDefault) {
        persisted = { ...persisted, defaultDepthLabels: depths.map((d) => d.label) };
      }
      persisted = bumpLastOpened(draft, persisted);
      return { ...s, draft, persisted };
    });
  },

  // ====== 范围管理 ======
  /**
   * 新建范围，立即激活并写入 persisted（无需另外保存）。
   * 返回新 range 的 id。
   */
  newRange(name: string, seats: number = DEFAULT_SEATS): string {
    let outId = '';
    setState((s) => {
      const range = makeRange(name, s.persisted.defaultDepthLabels, seats);
      outId = range.id;
      const draft = draftFromRange(range, range.depths[0]?.label ?? null, null, null);
      return {
        ...s,
        draft,
        persisted: bumpLastOpened(draft, {
          ...s.persisted,
          ranges: [range, ...s.persisted.ranges],
        }),
      };
    });
    return outId;
  },

  openRange(id: string) {
    setState((s) => {
      const found = s.persisted.ranges.find((r) => r.id === id);
      if (!found) return s;
      const draft = draftFromRange(
        found,
        s.persisted.lastOpenedDepthLabel,
        s.persisted.lastOpenedSeatId,
        s.persisted.lastOpenedOpponentId,
      );
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 保存当前 draft（整个 range 的 depths）。若 rangeId 为空则不操作。
   */
  save() {
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const base = commitEditing(s.draft);
      const now = Date.now();
      const name = base.name.trim() || 'Untitled';
      const ranges = s.persisted.ranges.map((r) =>
        r.id === base.rangeId
          ? {
              ...r,
              name,
              seats: base.seats,
              depths: base.depths.map(cloneDepth),
              customActions: base.customActions.map((c) => ({ ...c })),
              updatedAt: now,
            }
          : r,
      );
      const draft: DraftState = { ...base, name, dirty: false };
      return {
        ...s,
        draft,
        persisted: bumpLastOpened(draft, { ...s.persisted, ranges }),
      };
    });
  },

  /**
   * 另存为：基于当前 draft.depths 创建新 range（保留 depths 内容），并立即激活。
   */
  saveAs(name: string): string {
    let outId = '';
    setState((s) => {
      const base = commitEditing(s.draft);
      const finalName = name.trim() || `${base.name || 'Untitled'} (copy)`;
      const now = Date.now();
      const range: RangeDoc = {
        id: newId(),
        name: finalName,
        seats: base.seats,
        depths: base.depths.map(cloneDepth),
        customActions: base.customActions.map((c) => ({ ...c })),
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      const draft = draftFromRange(
        range,
        base.currentDepthLabel,
        base.currentSeatId,
        base.currentOpponentId,
      );
      return {
        ...s,
        draft,
        persisted: bumpLastOpened(draft, {
          ...s.persisted,
          ranges: [range, ...s.persisted.ranges],
        }),
      };
    });
    return outId;
  },

  rename(id: string, name: string) {
    setState((s) => {
      const finalName = name.trim() || 'Untitled';
      const ranges = s.persisted.ranges.map((r) =>
        r.id === id ? { ...r, name: finalName, updatedAt: Date.now() } : r,
      );
      const draft = s.draft.rangeId === id ? { ...s.draft, name: finalName } : s.draft;
      return { ...s, draft, persisted: { ...s.persisted, ranges } };
    });
  },

  duplicate(id: string): string | null {
    let outId: string | null = null;
    setState((s) => {
      const src = s.persisted.ranges.find((r) => r.id === id);
      if (!src) return s;
      const now = Date.now();
      const range: RangeDoc = {
        id: newId(),
        name: `${src.name} (copy)`,
        seats: clampSeats(src.seats),
        depths: src.depths.map(cloneDepth),
        customActions: (src.customActions ?? []).map((c) => ({ ...c })),
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      return { ...s, persisted: { ...s.persisted, ranges: [range, ...s.persisted.ranges] } };
    });
    return outId;
  },

  remove(id: string) {
    setState((s) => {
      const ranges = s.persisted.ranges.filter((r) => r.id !== id);
      const isCurrent = s.draft.rangeId === id;
      const draft: DraftState = isCurrent ? { ...EMPTY_DRAFT } : s.draft;
      return {
        ...s,
        draft,
        persisted: bumpLastOpened(draft, { ...s.persisted, ranges }),
      };
    });
  },

  setDefaultDepthLabels(labels: string[]) {
    setState((s) => ({
      ...s,
      persisted: { ...s.persisted, defaultDepthLabels: [...labels] },
    }));
  },

  // ====== 自定义动作按钮（仅在编辑模式下调用） ======

  /**
   * 新增一个自定义动作。返回新 id；若 label/color 非法则返回 null。
   * 仅修改 draft.customActions，dirty=true；不影响 cells。
   */
  addCustomAction(label: string, color: string): string | null {
    const trimmed = label.trim();
    if (!trimmed) return null;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) return null;
    let outId: string | null = null;
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const id = newCustomActionId();
      outId = id;
      const next: CustomAction = { id, label: trimmed, color: color.trim() };
      const draft: DraftState = {
        ...s.draft,
        customActions: [...s.draft.customActions, next],
        dirty: true,
      };
      return { ...s, draft };
    });
    return outId;
  },

  /** 更新一个已有自定义动作的 label / color。 */
  updateCustomAction(id: string, patch: { label?: string; color?: string }): boolean {
    let ok = false;
    setState((s) => {
      const idx = s.draft.customActions.findIndex((c) => c.id === id);
      if (idx < 0) return s;
      const cur = s.draft.customActions[idx];
      const nextLabel = patch.label !== undefined ? patch.label.trim() : cur.label;
      const nextColor = patch.color !== undefined ? patch.color.trim() : cur.color;
      if (!nextLabel) return s;
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(nextColor)) return s;
      if (nextLabel === cur.label && nextColor === cur.color) {
        ok = true;
        return s;
      }
      const customActions = s.draft.customActions.slice();
      customActions[idx] = { id: cur.id, label: nextLabel, color: nextColor };
      ok = true;
      return { ...s, draft: { ...s.draft, customActions, dirty: true } };
    });
    return ok;
  },

  /**
   * 删除一个自定义动作；同时把 draft 内所有 cells 中引用该 id 的格子置为 fold。
   * 内置动作 id 不会进入此分支。
   */
  removeCustomAction(id: string) {
    setState((s) => {
      if (!s.draft.customActions.some((c) => c.id === id)) return s;
      const customActions = s.draft.customActions.filter((c) => c.id !== id);
      const cleanCells = (cells: Record<string, Action>): Record<string, Action> => {
        let changed = false;
        const out: Record<string, Action> = {};
        for (const [k, v] of Object.entries(cells)) {
          if (v === id) {
            changed = true;
            continue;
          }
          out[k] = v;
        }
        return changed ? out : cells;
      };
      const depths = s.draft.depths.map((d) => {
        const seats: typeof d.seats = {};
        let depthChanged = false;
        for (const [seatId, bucket] of Object.entries(d.seats)) {
          const overall = cleanCells(bucket.overall);
          const vs: typeof bucket.vs = {};
          let vsChanged = false;
          for (const [oppId, cells] of Object.entries(bucket.vs)) {
            const next = cleanCells(cells);
            if (next !== cells) vsChanged = true;
            if (Object.keys(next).length > 0) vs[oppId] = next;
            else vsChanged = true;
          }
          const bucketChanged = overall !== bucket.overall || vsChanged;
          if (bucketChanged) depthChanged = true;
          const isEmpty =
            Object.keys(overall).length === 0 && Object.keys(vs).length === 0;
          if (!isEmpty) seats[seatId] = { overall, vs };
        }
        if (!depthChanged) return d;
        return { label: d.label, seats };
      });
      // 若当前快照里也引用了这个 id，要同步清掉，否则 cancel 时会复活
      let editSnapshot = s.draft.editSnapshot;
      if (editSnapshot) {
        const cleaned = cleanCells(editSnapshot.cells);
        if (cleaned !== editSnapshot.cells) {
          editSnapshot = { ...editSnapshot, cells: cleaned };
        }
      }
      return {
        ...s,
        draft: {
          ...s.draft,
          customActions,
          depths,
          editSnapshot,
          dirty: true,
        },
      };
    });
  },
};

export { DEFAULT_DEPTH_LABELS };
