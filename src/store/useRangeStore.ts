import { useSyncExternalStore } from 'react';
import type { Action, CellSegment, CustomAction } from '@/lib/colors';
import {
  cellSegments,
  clampWeight,
  makeCellValue,
  makeCellValueFromSegments,
  newCustomActionId,
} from '@/lib/colors';
import { ALL_HAND_KEYS } from '@/lib/hands';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
  type SeatOverride,
  getCellsForSeat,
  getCustomActionsForSeat,
  seatScope,
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
 * 两个维度：
 * - currentDepthLabel：筹码深度
 * - currentSeatId：英雄座位
 *
 * 编辑模式（§3.8）：
 * - editing=false 时网格的单格涂色（paintCell）/ 添加按钮等都不会改动数据。
 * - beginEdit() 拍下进入编辑前 (depth, seat) 当前可见的 cells / customActions 快照
 *   及它处在「shared / primary / 独立 / follower」的哪种状态；
 * - confirmEdit() 退出编辑模式但保留涂色；
 * - cancelEdit() 把快照写回，并按需要把「编辑期间分叉出来的 override」回滚为「跟随 shared」、
 *   或把「编辑期间被设置的 primary」回到 null。
 *
 * 座位间「跟随 / 独立」：见 lib/depths.ts 文档。
 */
export interface EditSnapshot {
  depthLabel: string;
  seatId: string;
  /** 进入编辑时该座位是否已经独立。true → 编辑目标是 override；cancel 写回 override。 */
  wasIndependent: boolean;
  /** 进入编辑时该座位是否是 depth 的 primary。 */
  wasPrimary: boolean;
  /** 进入编辑时 depth.primarySeatId 是否还是 null（首次编辑）。 */
  primaryWasNull: boolean;
  /** 进入编辑时该座位「看得见」的 cells 副本（独立 → override.cells；否则 → sharedCells）。 */
  cellsBefore: Record<string, Action>;
  /** 同上：customActions。 */
  customActionsBefore: CustomAction[];
}

export interface DraftState {
  rangeId: string | null;
  name: string;
  seats: number;
  depths: DepthGrid[];
  /**
   * 单格备注：key = hand id（如 `AKs`），value = 用户输入的文字。
   * 按 range 维度共用，不区分深度/座位。
   */
  notes: Record<string, string>;
  currentDepthLabel: string | null;
  currentSeatId: string | null;
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
  notes: {},
  currentDepthLabel: null,
  currentSeatId: null,
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

function draftFromRange(
  range: RangeDoc,
  preferLabel: string | null,
  preferSeatId: string | null,
): DraftState {
  const depths = range.depths.map(cloneDepth);
  const label =
    preferLabel && depths.some((d) => d.label === preferLabel)
      ? preferLabel
      : depths[0]?.label ?? null;
  const seatsCount = clampSeats(range.seats);
  const seatId = pickInitialSeat(seatsCount, preferSeatId);
  return {
    rangeId: range.id,
    name: range.name,
    seats: seatsCount,
    depths,
    notes: { ...(range.notes ?? {}) },
    currentDepthLabel: label,
    currentSeatId: seatId,
    dirty: false,
    editing: false,
    editSnapshot: null,
  };
}

function cloneOverride(o: SeatOverride): SeatOverride {
  return {
    cells: { ...o.cells },
    customActions: o.customActions.map((c) => ({ ...c })),
  };
}

function cloneSeatOverrides(
  src: Record<string, SeatOverride>,
): Record<string, SeatOverride> {
  const out: Record<string, SeatOverride> = {};
  for (const [k, v] of Object.entries(src)) out[k] = cloneOverride(v);
  return out;
}

function cloneDepth(d: DepthGrid): DepthGrid {
  return {
    label: d.label,
    sharedCells: { ...d.sharedCells },
    sharedCustomActions: d.sharedCustomActions.map((c) => ({ ...c })),
    seatOverrides: cloneSeatOverrides(d.seatOverrides),
    primarySeatId: d.primarySeatId,
  };
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

function customActionsEqual(
  a: readonly CustomAction[],
  b: readonly CustomAction[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].label !== b[i].label) return false;
    if (a[i].color !== b[i].color) return false;
  }
  return true;
}

function overrideEqual(a: SeatOverride, b: SeatOverride): boolean {
  if (!cellsEqual(a.cells, b.cells)) return false;
  if (!customActionsEqual(a.customActions, b.customActions)) return false;
  return true;
}

function overridesEqual(
  a: Record<string, SeatOverride>,
  b: Record<string, SeatOverride>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = a[k];
    const bv = b[k];
    if (!bv) return false;
    if (!overrideEqual(av, bv)) return false;
  }
  return true;
}

function depthEqual(a: DepthGrid, b: DepthGrid): boolean {
  if (a.label !== b.label) return false;
  if (a.primarySeatId !== b.primarySeatId) return false;
  if (!cellsEqual(a.sharedCells, b.sharedCells)) return false;
  if (!customActionsEqual(a.sharedCustomActions, b.sharedCustomActions)) return false;
  if (!overridesEqual(a.seatOverrides, b.seatOverrides)) return false;
  return true;
}

function notesEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function draftMatchesPersisted(draft: DraftState, persisted: PersistedState): boolean {
  if (!draft.rangeId) return true;
  const src = persisted.ranges.find((r) => r.id === draft.rangeId);
  if (!src) return false;
  if (src.name !== draft.name) return false;
  if (src.seats !== draft.seats) return false;
  if (!notesEqual(src.notes ?? {}, draft.notes)) return false;
  if (src.depths.length !== draft.depths.length) return false;
  for (let i = 0; i < src.depths.length; i++) {
    if (!depthEqual(src.depths[i], draft.depths[i])) return false;
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

/**
 * 给 sync 模块用：直接读取最新 persisted state（不走 React hook）。
 */
export function _getRangePersisted(): PersistedState {
  return state.persisted;
}

/**
 * 给 sync 模块用：直接订阅 store 任意变更（用于 schedulePush 触发）。
 */
export function _subscribeRangeStore(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * 给 sync 模块用：用从远端合并出的 persisted 替换本地。
 * - 若当前 draft 的 rangeId 已不在 ranges 里，回退到空 draft；
 * - 若仍存在，重新从 persisted 中读最新版本刷新 draft（保留当前选中的 depth/seat）。
 * - persisted 直接写盘（saveState）+ emit，UI 立即更新。
 */
export function _replaceRangePersisted(next: PersistedState): void {
  state = (() => {
    const draft = state.draft;
    if (!draft.rangeId) return { persisted: next, draft };
    const target = next.ranges.find((r) => r.id === draft.rangeId);
    if (!target) return { persisted: next, draft: { ...EMPTY_DRAFT } };
    return {
      persisted: next,
      draft: draftFromRange(
        target,
        draft.currentDepthLabel,
        draft.currentSeatId,
      ),
    };
  })();
  saveState(state.persisted);
  emit();
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

export const EMPTY_CELLS: Record<string, Action> = Object.freeze({});
const EMPTY_CUSTOM_ACTIONS: readonly CustomAction[] = Object.freeze([]);

/** 取当前激活 (depth) 的 DepthGrid。 */
function getCurrentDepth(draft: DraftState): DepthGrid | undefined {
  if (!draft.currentDepthLabel) return undefined;
  return draft.depths.find((d) => d.label === draft.currentDepthLabel);
}

/** 取当前 (depth, seat) 应渲染的 cells。 */
export function getCurrentCells(draft: DraftState): Record<string, Action> {
  const depth = getCurrentDepth(draft);
  if (!depth || !draft.currentSeatId) return EMPTY_CELLS;
  return getCellsForSeat(depth, draft.currentSeatId);
}

/** 取当前 (depth, seat) 应渲染的 customActions。 */
export function getCurrentCustomActions(draft: DraftState): CustomAction[] {
  const depth = getCurrentDepth(draft);
  if (!depth || !draft.currentSeatId) return EMPTY_CUSTOM_ACTIONS as CustomAction[];
  return getCustomActionsForSeat(depth, draft.currentSeatId);
}

/** 兼容旧引用名。 */
export const getCurrentSeatCells = getCurrentCells;
export const getCurrentDepthCells = getCurrentCells;

export function useCustomActions(): CustomAction[] {
  return useSyncExternalStore(
    subscribe,
    () => getCurrentCustomActions(getSnapshot().draft),
    () => getCurrentCustomActions(getSnapshot().draft),
  );
}

export function useNotes(): Record<string, string> {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().draft.notes,
    () => getSnapshot().draft.notes,
  );
}

// -------------------- Internal helpers --------------------

/**
 * 在当前激活 (depth, seat) 上执行作用域感知的修改：
 * - 若该座位已独立 → mutator 接收并返回 override（cells + customActions）。
 * - 若该座位是 primary（或还没人是 primary）→ mutator 接收并返回 shared（cells + customActions）。
 *   特殊：若 primary 是 null，本次写入会把 primary 设为当前座位（仅当 mutator 返回的内容与原 shared 不同）。
 * - 若该座位是 follower（primary 是别人）→ 调用 mutator 时先 COW shared 到 override，
 *   mutator 返回新的 override；写回 seatOverrides[seatId]。
 *
 * mutator 接收当前 scope 的 cells + customActions（可能是 shared 也可能是 override），
 * 返回新的 cells + customActions。
 * - 若新值与旧值「全等于」（cellsEqual 且 customActionsEqual），mutator 自行 short-circuit 即可，
 *   外层会判断 referential equality 决定是否触发 dirty。
 */
function applyToSeatScope(
  s: InternalState,
  mutator: (input: {
    cells: Record<string, Action>;
    customActions: CustomAction[];
    /** 'shared' = 当前正在写 sharedCells；'override' = 当前正在写 override.cells。 */
    scope: 'shared' | 'override';
  }) => { cells: Record<string, Action>; customActions: CustomAction[] },
): InternalState {
  const draft = s.draft;
  if (!draft.currentDepthLabel || !draft.currentSeatId) return s;
  const dIdx = draft.depths.findIndex((d) => d.label === draft.currentDepthLabel);
  if (dIdx < 0) return s;
  const depth = draft.depths[dIdx];
  const seatId = draft.currentSeatId;
  const scope = seatScope(depth, seatId);

  let nextDepth: DepthGrid;
  if (scope === 'override') {
    const cur = depth.seatOverrides[seatId];
    const out = mutator({
      cells: cur.cells,
      customActions: cur.customActions,
      scope: 'override',
    });
    if (
      cellsEqual(out.cells, cur.cells) &&
      customActionsEqual(out.customActions, cur.customActions)
    ) {
      return s;
    }
    const nextOverride: SeatOverride = {
      cells: out.cells,
      customActions: out.customActions,
    };
    nextDepth = {
      ...depth,
      seatOverrides: { ...depth.seatOverrides, [seatId]: nextOverride },
    };
  } else if (scope === 'shared') {
    const out = mutator({
      cells: depth.sharedCells,
      customActions: depth.sharedCustomActions,
      scope: 'shared',
    });
    if (
      cellsEqual(out.cells, depth.sharedCells) &&
      customActionsEqual(out.customActions, depth.sharedCustomActions)
    ) {
      return s;
    }
    nextDepth = {
      ...depth,
      sharedCells: out.cells,
      sharedCustomActions: out.customActions,
      // 首次写入：把 primary 设为当前座位
      primarySeatId: depth.primarySeatId ?? seatId,
    };
  } else {
    // follower：COW shared → override，再让 mutator 写 override
    const baseCells = { ...depth.sharedCells };
    const baseActions = depth.sharedCustomActions.map((c) => ({ ...c }));
    const out = mutator({
      cells: baseCells,
      customActions: baseActions,
      scope: 'override',
    });
    // follower 必然要写入（COW 后没有变化的情形：mutator 把 shared 原样返回）
    if (cellsEqual(out.cells, depth.sharedCells) && customActionsEqual(out.customActions, depth.sharedCustomActions)) {
      return s;
    }
    const nextOverride: SeatOverride = {
      cells: out.cells,
      customActions: out.customActions,
    };
    nextDepth = {
      ...depth,
      seatOverrides: { ...depth.seatOverrides, [seatId]: nextOverride },
    };
  }

  const depths = draft.depths.slice();
  depths[dIdx] = nextDepth;
  return { ...s, draft: { ...draft, depths, dirty: true } };
}

/** 通用：写一格 cells（fold = 删除条目）。基于 applyToSeatScope。 */
function writeCell(
  s: InternalState,
  hand: string,
  isFold: boolean,
  value: Action,
): InternalState {
  return applyToSeatScope(s, ({ cells, customActions }) => {
    const prev = cells[hand] ?? 'fold';
    const nextValue = isFold ? 'fold' : value;
    if (prev === nextValue) return { cells, customActions };
    const nextCells = { ...cells };
    if (isFold) delete nextCells[hand];
    else nextCells[hand] = value;
    return { cells: nextCells, customActions };
  });
}

function bumpLastOpened(draft: DraftState, persisted: PersistedState): PersistedState {
  const next: PersistedState = {
    ...persisted,
    lastOpenedRangeId: draft.rangeId,
    lastOpenedDepthLabel: draft.currentDepthLabel,
    lastOpenedSeatId: draft.currentSeatId,
  };
  if (
    next.lastOpenedRangeId !== persisted.lastOpenedRangeId ||
    next.lastOpenedDepthLabel !== persisted.lastOpenedDepthLabel ||
    next.lastOpenedSeatId !== persisted.lastOpenedSeatId
  ) {
    next.settingsUpdatedAt = Date.now();
  }
  return next;
}

// -------------------- 编辑模式辅助 --------------------

/**
 * 把编辑模式的 snapshot 应用回当前 (depth, seat) 的 cells / customActions，并清除 editing/editSnapshot。
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
      let nextDepth: DepthGrid;
      if (snap.wasIndependent) {
        // 写回该座位的 override
        nextDepth = {
          ...depth,
          seatOverrides: {
            ...depth.seatOverrides,
            [snap.seatId]: {
              cells: { ...snap.cellsBefore },
              customActions: snap.customActionsBefore.map((c) => ({ ...c })),
            },
          },
        };
      } else if (snap.wasPrimary || snap.primaryWasNull) {
        // 写回 shared；若编辑前 primary 是 null，把它恢复为 null
        nextDepth = {
          ...depth,
          sharedCells: { ...snap.cellsBefore },
          sharedCustomActions: snap.customActionsBefore.map((c) => ({ ...c })),
          primarySeatId: snap.primaryWasNull ? null : depth.primarySeatId,
        };
      } else {
        // follower：编辑期间可能 COW 出了 override，cancel 时删掉它
        if (Object.prototype.hasOwnProperty.call(depth.seatOverrides, snap.seatId)) {
          const seatOverrides = { ...depth.seatOverrides };
          delete seatOverrides[snap.seatId];
          nextDepth = { ...depth, seatOverrides };
        } else {
          nextDepth = depth;
        }
      }
      const next = depths.slice();
      next[dIdx] = nextDepth;
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
      const seatId = d.currentSeatId;
      const scope = seatScope(depth, seatId);
      const wasIndependent = scope === 'override';
      const wasPrimary = !wasIndependent && depth.primarySeatId === seatId;
      const primaryWasNull = !wasIndependent && depth.primarySeatId == null;
      const cellsBefore = wasIndependent
        ? { ...depth.seatOverrides[seatId].cells }
        : { ...depth.sharedCells };
      const customActionsBefore = wasIndependent
        ? depth.seatOverrides[seatId].customActions.map((c) => ({ ...c }))
        : depth.sharedCustomActions.map((c) => ({ ...c }));
      const editSnapshot: EditSnapshot = {
        depthLabel: depth.label,
        seatId,
        wasIndependent,
        wasPrimary,
        primaryWasNull,
        cellsBefore,
        customActionsBefore,
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
  /**
   * 给指定 hand 涂上动作色。
   * - `weight` 默认 100（整格填充）；传 1-99 时按 `id@weight` 编码部分填充
   * - `weight` 对 `fold` 无意义，会被忽略（fold 永远清空该格）
   */
  paintCell(hand: string, action: Action, weight: number = 100) {
    setState((s) => {
      if (!s.draft.editing) return s;
      const nextValue =
        action === 'fold' ? 'fold' : makeCellValue(action, clampWeight(weight));
      return writeCell(s, hand, action === 'fold', nextValue);
    });
  },

  /**
   * 把一格设为多个动作的混合占比（如 50% A + 40% B + 10% C）。
   * - `segments` 为空 / 总权重为 0 → 视为 fold（清空该格）
   * - 各段权重在内部夹到 [1,100]，总和 > 100 时从尾部裁剪
   */
  paintCellMix(hand: string, segments: readonly CellSegment[]) {
    setState((s) => {
      if (!s.draft.editing) return s;
      const value = makeCellValueFromSegments(segments);
      const isFold = value === 'fold';
      return writeCell(s, hand, isFold, isFold ? 'fold' : value);
    });
  },

  fillAll(action: Action) {
    setState((s) => {
      return applyToSeatScope(s, ({ cells, customActions }) => {
        const target: Record<string, Action> = {};
        if (action !== 'fold') {
          for (const k of ALL_HAND_KEYS) target[k] = action;
        }
        if (cellsEqual(cells, target)) return { cells, customActions };
        return { cells: target, customActions };
      });
    });
  },

  clearAll() {
    this.fillAll('fold');
  },

  // ====== 单格备注 ======
  /**
   * 设置某个 hand 的备注文字。空串 / 纯空白会被视作「删除该备注」。
   * 备注按 range 维度共用，所有 (深度, 座位) 都看到同一份。
   * 不受编辑模式限制：备注是元数据，不属于网格涂色，可随时编辑（仍计 dirty）。
   */
  setNote(hand: string, text: string) {
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const trimmed = text.replace(/\s+$/u, '');
      const cur = s.draft.notes[hand] ?? '';
      if (cur === trimmed) return s;
      const notes = { ...s.draft.notes };
      if (trimmed) notes[hand] = trimmed;
      else delete notes[hand];
      const next: DraftState = { ...s.draft, notes };
      const dirty = !draftMatchesPersisted(next, s.persisted);
      return { ...s, draft: { ...next, dirty } };
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
      return {
        ...s,
        draft: {
          ...s.draft,
          seats: next,
          currentSeatId: validSeat,
          dirty: true,
        },
      };
    });
  },

  // ====== Depth / Seat 切换 ======
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
      const draft: DraftState = { ...base, currentSeatId: seatId };
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
      const draft = draftFromRange(range, range.depths[0]?.label ?? null, null);
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
              notes: { ...base.notes },
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
        notes: { ...base.notes },
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      const draft = draftFromRange(
        range,
        base.currentDepthLabel,
        base.currentSeatId,
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
        notes: { ...(src.notes ?? {}) },
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
      if (!s.persisted.ranges.some((r) => r.id === id)) return s;
      const ranges = s.persisted.ranges.filter((r) => r.id !== id);
      const isCurrent = s.draft.rangeId === id;
      const draft: DraftState = isCurrent ? { ...EMPTY_DRAFT } : s.draft;
      const rangeTombstones = { ...s.persisted.rangeTombstones, [id]: Date.now() };
      return {
        ...s,
        draft,
        persisted: bumpLastOpened(draft, { ...s.persisted, ranges, rangeTombstones }),
      };
    });
  },

  setDefaultDepthLabels(labels: string[]) {
    setState((s) => ({
      ...s,
      persisted: {
        ...s.persisted,
        defaultDepthLabels: [...labels],
        settingsUpdatedAt: Date.now(),
      },
    }));
  },

  // ====== 自定义动作按钮（按 (depth, seat) 拆分） ======

  /**
   * 在当前 (depth, seat) 作用域里新增一个自定义动作。返回新 id；若 label/color 非法则返回 null。
   * - 当前是 follower 座位 → 第一次新增会触发 COW shared → override，新按钮只属于本座位。
   * - 当前是独立座位 → 新按钮只属于本座位的 override。
   * - 当前是 primary（或还没人是 primary）→ 新按钮加入 sharedCustomActions，所有未独立座位都看到。
   */
  addCustomAction(label: string, color: string): string | null {
    const trimmed = label.trim();
    if (!trimmed) return null;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim())) return null;
    let outId: string | null = null;
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const id = newCustomActionId();
      const next: CustomAction = { id, label: trimmed, color: color.trim() };
      const after = applyToSeatScope(s, ({ cells, customActions }) => {
        return { cells, customActions: [...customActions, next] };
      });
      if (after !== s) outId = id;
      return after;
    });
    return outId;
  },

  /** 在当前作用域里更新一个已有自定义动作的 label / color。 */
  updateCustomAction(id: string, patch: { label?: string; color?: string }): boolean {
    let ok = false;
    setState((s) => {
      const after = applyToSeatScope(s, ({ cells, customActions }) => {
        const idx = customActions.findIndex((c) => c.id === id);
        if (idx < 0) return { cells, customActions };
        const cur = customActions[idx];
        const nextLabel = patch.label !== undefined ? patch.label.trim() : cur.label;
        const nextColor = patch.color !== undefined ? patch.color.trim() : cur.color;
        if (!nextLabel) return { cells, customActions };
        if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(nextColor)) return { cells, customActions };
        if (nextLabel === cur.label && nextColor === cur.color) {
          ok = true;
          return { cells, customActions };
        }
        const nextActions = customActions.slice();
        nextActions[idx] = { id: cur.id, label: nextLabel, color: nextColor };
        ok = true;
        return { cells, customActions: nextActions };
      });
      return after;
    });
    return ok;
  },

  /**
   * 在当前作用域里删除一个自定义动作；同时把作用域内 cells 中引用该 id 的格子清扫掉。
   * - 不跨座位清扫；其它独立座位若也用了同名 id，那是它们自己的副本，不动。
   */
  removeCustomAction(id: string) {
    setState((s) => {
      const cleanCells = (cells: Record<string, Action>): Record<string, Action> => {
        let changed = false;
        const out: Record<string, Action> = {};
        for (const [k, v] of Object.entries(cells)) {
          const segs = cellSegments(v);
          if (!segs.some((seg) => seg.id === id)) {
            out[k] = v;
            continue;
          }
          changed = true;
          const kept = segs.filter((seg) => seg.id !== id);
          if (kept.length === 0) continue;
          const nextValue = makeCellValueFromSegments(kept);
          if (nextValue !== 'fold') out[k] = nextValue;
        }
        return changed ? out : cells;
      };
      const after = applyToSeatScope(s, ({ cells, customActions }) => {
        if (!customActions.some((c) => c.id === id)) {
          return { cells, customActions };
        }
        const nextActions = customActions.filter((c) => c.id !== id);
        const nextCells = cleanCells(cells);
        return { cells: nextCells, customActions: nextActions };
      });
      if (after === s) return s;
      // 同步清掉 editSnapshot.cellsBefore 中对该 id 的引用，避免 cancel 时复活
      const snap = after.draft.editSnapshot;
      if (!snap) return after;
      const cleaned = cleanCells(snap.cellsBefore);
      if (cleaned === snap.cellsBefore) return after;
      return {
        ...after,
        draft: {
          ...after.draft,
          editSnapshot: { ...snap, cellsBefore: cleaned },
        },
      };
    });
  },
};

export { DEFAULT_DEPTH_LABELS };
