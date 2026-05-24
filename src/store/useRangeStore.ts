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
  type VersusGroup,
  emptyVersusGroup,
  getCellsForSeat,
  getCellsForVs,
  getCustomActionsForSeat,
  getCustomActionsForVs,
  seatScope,
  vsSeatScope,
} from '@/lib/depths';
import { getOtherSeats, seatsForCount, type SeatId } from '@/lib/seats';
import {
  clampSeats,
  DEFAULT_SEATS,
  loadState,
  makeRange,
  newId,
  sanitizeRangeDoc,
  saveState,
  type PersistedState,
  type RangeDoc,
} from './storage';

/** 导出/导入 JSON 文件外层信封，方便未来扩展兼容性。 */
const EXPORT_TYPE = 'hrm-range';
const EXPORT_VERSION = 1;

export interface ExportEnvelope {
  type: typeof EXPORT_TYPE;
  version: number;
  exportedAt: number;
  range: RangeDoc;
}

export interface ImportResult {
  ok: boolean;
  id?: string;
  name?: string;
  error?: string;
}

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
  /**
   * 进入编辑时的对战座位（vs_seat）：
   * - null → 编辑目标是 depth 主体（默认/RFI 视图），wasIndependent/wasPrimary 等指向 hero 维度。
   * - 非 null → 编辑目标是 depth.versus[seatId] 内部的某个对战表，
   *   wasIndependent/wasPrimary 等指向「该 vs 在群组内的 shared/follower/override 状态」。
   */
  vsSeatId: string | null;
  /** 进入编辑时该（hero or vs）座位是否已经独立。true → 编辑目标是 override；cancel 写回 override。 */
  wasIndependent: boolean;
  /** 进入编辑时该座位是否是 primary（hero 维度看 depth.primarySeatId；vs 维度看群组的 primaryVsSeatId）。 */
  wasPrimary: boolean;
  /** 进入编辑时 primary 是否还是 null（首次编辑）。 */
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
   * 按 range 维度共用，不区分深度/座位/对战。
   */
  notes: Record<string, string>;
  currentDepthLabel: string | null;
  currentSeatId: string | null;
  /**
   * 当前查看的对战座位（vs_seat）：
   * - null → 默认/RFI 视图（看 depth 主体）
   * - 非 null → 看 depth.versus[currentSeatId].vsSharedCells / vsSeatOverrides[currentVsSeatId]
   * 切换 hero_seat 或 depth 时若 vs 不再合法（不在 activeVsSeats），会自动回退到 null。
   */
  currentVsSeatId: string | null;
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
  currentVsSeatId: null,
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
  preferVsSeatId: string | null,
): DraftState {
  const depths = range.depths.map(cloneDepth);
  const label =
    preferLabel && depths.some((d) => d.label === preferLabel)
      ? preferLabel
      : depths[0]?.label ?? null;
  const seatsCount = clampSeats(range.seats);
  const seatId = pickInitialSeat(seatsCount, preferSeatId);
  let vsSeatId: string | null = null;
  if (preferVsSeatId && label) {
    const depth = depths.find((d) => d.label === label);
    const group = depth?.versus?.[seatId];
    if (group?.activeVsSeats.includes(preferVsSeatId)) {
      vsSeatId = preferVsSeatId;
    }
  }
  return {
    rangeId: range.id,
    name: range.name,
    seats: seatsCount,
    depths,
    notes: { ...(range.notes ?? {}) },
    currentDepthLabel: label,
    currentSeatId: seatId,
    currentVsSeatId: vsSeatId,
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

function cloneVersusGroup(g: VersusGroup): VersusGroup {
  return {
    activeVsSeats: [...g.activeVsSeats],
    vsSharedCells: { ...g.vsSharedCells },
    vsSharedCustomActions: g.vsSharedCustomActions.map((c) => ({ ...c })),
    vsSeatOverrides: cloneSeatOverrides(g.vsSeatOverrides),
    primaryVsSeatId: g.primaryVsSeatId,
  };
}

function cloneVersus(
  v?: Record<string, VersusGroup>,
): Record<string, VersusGroup> | undefined {
  if (!v) return undefined;
  const out: Record<string, VersusGroup> = {};
  for (const [k, g] of Object.entries(v)) out[k] = cloneVersusGroup(g);
  return out;
}

function cloneDepth(d: DepthGrid): DepthGrid {
  const next: DepthGrid = {
    label: d.label,
    sharedCells: { ...d.sharedCells },
    sharedCustomActions: d.sharedCustomActions.map((c) => ({ ...c })),
    seatOverrides: cloneSeatOverrides(d.seatOverrides),
    primarySeatId: d.primarySeatId,
  };
  if (d.versus) next.versus = cloneVersus(d.versus);
  return next;
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

function versusGroupEqual(a: VersusGroup, b: VersusGroup): boolean {
  if (a.primaryVsSeatId !== b.primaryVsSeatId) return false;
  if (a.activeVsSeats.length !== b.activeVsSeats.length) return false;
  for (let i = 0; i < a.activeVsSeats.length; i++) {
    if (a.activeVsSeats[i] !== b.activeVsSeats[i]) return false;
  }
  if (!cellsEqual(a.vsSharedCells, b.vsSharedCells)) return false;
  if (!customActionsEqual(a.vsSharedCustomActions, b.vsSharedCustomActions)) return false;
  if (!overridesEqual(a.vsSeatOverrides, b.vsSeatOverrides)) return false;
  return true;
}

function versusEqual(
  a: Record<string, VersusGroup> | undefined,
  b: Record<string, VersusGroup> | undefined,
): boolean {
  const ka = a ? Object.keys(a) : [];
  const kb = b ? Object.keys(b) : [];
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = (a as Record<string, VersusGroup>)[k];
    const bv = b?.[k];
    if (!bv) return false;
    if (!versusGroupEqual(av, bv)) return false;
  }
  return true;
}

function depthEqual(a: DepthGrid, b: DepthGrid): boolean {
  if (a.label !== b.label) return false;
  if (a.primarySeatId !== b.primarySeatId) return false;
  if (!cellsEqual(a.sharedCells, b.sharedCells)) return false;
  if (!customActionsEqual(a.sharedCustomActions, b.sharedCustomActions)) return false;
  if (!overridesEqual(a.seatOverrides, b.seatOverrides)) return false;
  if (!versusEqual(a.versus, b.versus)) return false;
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
        persisted.lastOpenedVsSeatId,
      )
    : { ...EMPTY_DRAFT };
  return { persisted, draft };
}

let state: InternalState = buildInitialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * 把当前 draft 的内容合并写回 persisted.ranges[id]，并清除 dirty。
 * - 仅在 rangeId 存在且 dirty=true 时动作
 * - 不改动编辑模式状态（editing / editSnapshot 原样保留）
 * - 返回新的 InternalState；不副作用、不通知监听者
 */
function commitDraftToPersisted(s: InternalState): InternalState {
  if (!s.draft.rangeId || !s.draft.dirty) return s;
  const base = s.draft;
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
}

function setState(updater: (s: InternalState) => InternalState) {
  let next = updater(state);
  // 自动保存：非编辑模式下只要 draft 有改动，立即合并到 persisted。
  // 编辑模式中的涂色改动不在这里落盘，留到 confirmEdit() 退出编辑后由后续 setState 兜底提交，
  // 或被 cancelEdit() 回滚后视情况提交（仅当回滚后仍有非涂色 dirty 时）。
  if (next.draft.rangeId && next.draft.dirty && !next.draft.editing) {
    next = commitDraftToPersisted(next);
  }
  state = next;
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
        draft.currentVsSeatId,
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

/** 取当前 (depth, seat, vs?) 应渲染的 cells。 */
export function getCurrentCells(draft: DraftState): Record<string, Action> {
  const depth = getCurrentDepth(draft);
  if (!depth || !draft.currentSeatId) return EMPTY_CELLS;
  if (draft.currentVsSeatId === null) {
    return getCellsForSeat(depth, draft.currentSeatId);
  }
  return getCellsForVs(depth, draft.currentSeatId, draft.currentVsSeatId);
}

/** 取当前 (depth, seat, vs?) 应渲染的 customActions。 */
export function getCurrentCustomActions(draft: DraftState): CustomAction[] {
  const depth = getCurrentDepth(draft);
  if (!depth || !draft.currentSeatId) return EMPTY_CUSTOM_ACTIONS as CustomAction[];
  if (draft.currentVsSeatId === null) {
    return getCustomActionsForSeat(depth, draft.currentSeatId);
  }
  return getCustomActionsForVs(depth, draft.currentSeatId, draft.currentVsSeatId);
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

/**
 * applyToSeatScope 的 vs 维度对偶版：
 * 在当前激活 (depth, hero_seat, vs_seat) 上执行写入，作用域判定参照 vsSeatScope（shared/override/follower）。
 *
 * 不变式：
 * - 必须 currentVsSeatId !== null；否则 caller 应走 applyToSeatScope。
 * - vs 必须是 hero 之外的合法座位；否则视为非法不写入。
 * - vs 必须已在 versus[hero].activeVsSeats 内（即用户已显式 addVsSeat）；否则不写入。
 *   这条规则确保「未被用户激活的对战表不会被静默创建」。
 */
function applyToVsSeatScope(
  s: InternalState,
  mutator: (input: {
    cells: Record<string, Action>;
    customActions: CustomAction[];
    /** 'shared' = 当前正在写 vsSharedCells；'override' = 当前正在写 vsSeatOverrides。 */
    scope: 'shared' | 'override';
  }) => { cells: Record<string, Action>; customActions: CustomAction[] },
): InternalState {
  const draft = s.draft;
  if (!draft.currentDepthLabel || !draft.currentSeatId) return s;
  const vsSeatId = draft.currentVsSeatId;
  if (vsSeatId === null) return s;
  const heroSeatId = draft.currentSeatId;
  if (!(getOtherSeats(draft.seats, heroSeatId) as string[]).includes(vsSeatId)) {
    return s;
  }
  const dIdx = draft.depths.findIndex((d) => d.label === draft.currentDepthLabel);
  if (dIdx < 0) return s;
  const depth = draft.depths[dIdx];
  const versus = depth.versus ?? {};
  const group = versus[heroSeatId];
  if (!group || !group.activeVsSeats.includes(vsSeatId)) return s;

  const scope = vsSeatScope(depth, heroSeatId, vsSeatId);
  let nextGroup: VersusGroup;
  if (scope === 'override') {
    const cur = group.vsSeatOverrides[vsSeatId];
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
    nextGroup = {
      ...group,
      vsSeatOverrides: {
        ...group.vsSeatOverrides,
        [vsSeatId]: { cells: out.cells, customActions: out.customActions },
      },
    };
  } else if (scope === 'shared') {
    const out = mutator({
      cells: group.vsSharedCells,
      customActions: group.vsSharedCustomActions,
      scope: 'shared',
    });
    if (
      cellsEqual(out.cells, group.vsSharedCells) &&
      customActionsEqual(out.customActions, group.vsSharedCustomActions)
    ) {
      return s;
    }
    nextGroup = {
      ...group,
      vsSharedCells: out.cells,
      vsSharedCustomActions: out.customActions,
      primaryVsSeatId: group.primaryVsSeatId ?? vsSeatId,
    };
  } else {
    // follower：COW vsShared → vsSeatOverrides
    const baseCells = { ...group.vsSharedCells };
    const baseActions = group.vsSharedCustomActions.map((c) => ({ ...c }));
    const out = mutator({
      cells: baseCells,
      customActions: baseActions,
      scope: 'override',
    });
    if (
      cellsEqual(out.cells, group.vsSharedCells) &&
      customActionsEqual(out.customActions, group.vsSharedCustomActions)
    ) {
      return s;
    }
    nextGroup = {
      ...group,
      vsSeatOverrides: {
        ...group.vsSeatOverrides,
        [vsSeatId]: { cells: out.cells, customActions: out.customActions },
      },
    };
  }

  const depths = draft.depths.slice();
  depths[dIdx] = {
    ...depth,
    versus: { ...versus, [heroSeatId]: nextGroup },
  };
  return { ...s, draft: { ...draft, depths, dirty: true } };
}

/**
 * 当前作用域写入的统一入口：按 currentVsSeatId 分发到 hero / vs 维度。
 * 所有涂色 / customAction 操作都应走这个入口，而不是直接调用底下两个。
 */
function applyAtCurrentScope(
  s: InternalState,
  mutator: (input: {
    cells: Record<string, Action>;
    customActions: CustomAction[];
    scope: 'shared' | 'override';
  }) => { cells: Record<string, Action>; customActions: CustomAction[] },
): InternalState {
  if (s.draft.currentVsSeatId === null) {
    return applyToSeatScope(s, mutator);
  }
  return applyToVsSeatScope(s, mutator);
}

/** 通用：写一格 cells（fold = 删除条目）。基于 applyAtCurrentScope。 */
function writeCell(
  s: InternalState,
  hand: string,
  isFold: boolean,
  value: Action,
): InternalState {
  return applyAtCurrentScope(s, ({ cells, customActions }) => {
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
    lastOpenedVsSeatId: draft.currentVsSeatId,
  };
  if (
    next.lastOpenedRangeId !== persisted.lastOpenedRangeId ||
    next.lastOpenedDepthLabel !== persisted.lastOpenedDepthLabel ||
    next.lastOpenedSeatId !== persisted.lastOpenedSeatId ||
    next.lastOpenedVsSeatId !== persisted.lastOpenedVsSeatId
  ) {
    next.settingsUpdatedAt = Date.now();
  }
  return next;
}

// -------------------- 编辑模式辅助 --------------------

/**
 * 给定一个 depth + (hero seat, vs seat) 目标，构造对应的 EditSnapshot。
 * - vsSeatId=null → hero 维度（默认/RFI 表）
 * - vsSeatId 非 null → 必须已存在于 versus[seatId].activeVsSeats，否则返回 null
 * 不会修改任何状态，仅读取当前 depth 的 shared/override 配置。
 */
function takeEditSnapshot(
  depth: DepthGrid,
  seatId: string,
  vsSeatId: string | null,
): EditSnapshot | null {
  let wasIndependent: boolean;
  let wasPrimary: boolean;
  let primaryWasNull: boolean;
  let cellsBefore: Record<string, Action>;
  let customActionsBefore: CustomAction[];

  if (vsSeatId === null) {
    const scope = seatScope(depth, seatId);
    wasIndependent = scope === 'override';
    wasPrimary = !wasIndependent && depth.primarySeatId === seatId;
    primaryWasNull = !wasIndependent && depth.primarySeatId == null;
    cellsBefore = wasIndependent
      ? { ...depth.seatOverrides[seatId].cells }
      : { ...depth.sharedCells };
    customActionsBefore = wasIndependent
      ? depth.seatOverrides[seatId].customActions.map((c) => ({ ...c }))
      : depth.sharedCustomActions.map((c) => ({ ...c }));
  } else {
    const group = depth.versus?.[seatId];
    if (!group || !group.activeVsSeats.includes(vsSeatId)) return null;
    const scope = vsSeatScope(depth, seatId, vsSeatId);
    wasIndependent = scope === 'override';
    wasPrimary = !wasIndependent && group.primaryVsSeatId === vsSeatId;
    primaryWasNull = !wasIndependent && group.primaryVsSeatId == null;
    cellsBefore = wasIndependent
      ? { ...group.vsSeatOverrides[vsSeatId].cells }
      : { ...group.vsSharedCells };
    customActionsBefore = wasIndependent
      ? group.vsSeatOverrides[vsSeatId].customActions.map((c) => ({ ...c }))
      : group.vsSharedCustomActions.map((c) => ({ ...c }));
  }

  return {
    depthLabel: depth.label,
    seatId,
    vsSeatId,
    wasIndependent,
    wasPrimary,
    primaryWasNull,
    cellsBefore,
    customActionsBefore,
  };
}

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
      if (snap.vsSeatId === null) {
        // —— hero 维度回滚（编辑的是 depth 主体 / 默认表） ——
        if (snap.wasIndependent) {
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
          nextDepth = {
            ...depth,
            sharedCells: { ...snap.cellsBefore },
            sharedCustomActions: snap.customActionsBefore.map((c) => ({ ...c })),
            primarySeatId: snap.primaryWasNull ? null : depth.primarySeatId,
          };
        } else {
          if (Object.prototype.hasOwnProperty.call(depth.seatOverrides, snap.seatId)) {
            const seatOverrides = { ...depth.seatOverrides };
            delete seatOverrides[snap.seatId];
            nextDepth = { ...depth, seatOverrides };
          } else {
            nextDepth = depth;
          }
        }
      } else {
        // —— vs 维度回滚（编辑的是 depth.versus[seatId] 内某个 vs 表） ——
        const heroSeatId = snap.seatId;
        const vsSeatId = snap.vsSeatId;
        const versus = depth.versus;
        const group = versus?.[heroSeatId];
        if (!versus || !group) {
          // 群组在编辑期间被移除（理论上不应发生，因为 removeVsSeat 也只在 editing 下做且我们这就在编辑），保守返回原 depth
          nextDepth = depth;
        } else {
          let nextGroup: VersusGroup;
          if (snap.wasIndependent) {
            nextGroup = {
              ...group,
              vsSeatOverrides: {
                ...group.vsSeatOverrides,
                [vsSeatId]: {
                  cells: { ...snap.cellsBefore },
                  customActions: snap.customActionsBefore.map((c) => ({ ...c })),
                },
              },
            };
          } else if (snap.wasPrimary || snap.primaryWasNull) {
            nextGroup = {
              ...group,
              vsSharedCells: { ...snap.cellsBefore },
              vsSharedCustomActions: snap.customActionsBefore.map((c) => ({ ...c })),
              primaryVsSeatId: snap.primaryWasNull ? null : group.primaryVsSeatId,
            };
          } else {
            if (
              Object.prototype.hasOwnProperty.call(group.vsSeatOverrides, vsSeatId)
            ) {
              const vsSeatOverrides = { ...group.vsSeatOverrides };
              delete vsSeatOverrides[vsSeatId];
              nextGroup = { ...group, vsSeatOverrides };
            } else {
              nextGroup = group;
            }
          }
          nextDepth = {
            ...depth,
            versus: { ...versus, [heroSeatId]: nextGroup },
          };
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
      const editSnapshot = takeEditSnapshot(depth, d.currentSeatId, d.currentVsSeatId);
      if (!editSnapshot) return s;
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
   * 批量给多个 hand 一次性涂上同一动作（用于 Shift+点击的矩形范围涂色）。
   * - 单次 setState，对大矩形避免 169 次 re-render
   * - 与 paintCell 语义一致：fold 视为清空、其它动作使用 weight 编码
   * - hands 为空 / 不在编辑模式 / 没有任何格子真正变化 → 原样返回
   */
  paintCells(hands: readonly string[], action: Action, weight: number = 100) {
    setState((s) => {
      if (!s.draft.editing) return s;
      if (hands.length === 0) return s;
      const isFold = action === 'fold';
      const nextValue: Action = isFold ? 'fold' : makeCellValue(action, clampWeight(weight));
      return applyAtCurrentScope(s, ({ cells, customActions }) => {
        let nextCells: Record<string, Action> | null = null;
        for (const hand of hands) {
          const cur = nextCells ?? cells;
          const prev = cur[hand] ?? 'fold';
          if (prev === nextValue) continue;
          if (!nextCells) nextCells = { ...cells };
          if (isFold) delete nextCells[hand];
          else nextCells[hand] = nextValue;
        }
        if (!nextCells) return { cells, customActions };
        return { cells: nextCells, customActions };
      });
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
      return applyAtCurrentScope(s, ({ cells, customActions }) => {
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
          // 桌人数变化后 vs 候选范围可能整个变了，简单起见统一回退到默认/RFI 视图。
          // versus 数据本身保留（不丢失用户数据），只是 UI 上回到默认表。
          currentVsSeatId: null,
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
      // 新 depth 下当前 vs 可能不存在（每个 depth 的 versus 是独立的）→ 回退到默认表
      let currentVsSeatId = base.currentVsSeatId;
      if (currentVsSeatId !== null && base.currentSeatId) {
        const nextDepth = base.depths.find((d) => d.label === label);
        const group = nextDepth?.versus?.[base.currentSeatId];
        if (!group?.activeVsSeats.includes(currentVsSeatId)) {
          currentVsSeatId = null;
        }
      }
      const draft: DraftState = { ...base, currentDepthLabel: label, currentVsSeatId };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  switchSeat(seatId: string) {
    setState((s) => {
      if (s.draft.currentSeatId === seatId) return s;
      const order = seatsForCount(s.draft.seats);
      if (!(order as readonly string[]).includes(seatId)) return s;
      const d = s.draft;
      // 编辑模式下切换座位：保留当前已涂色（视为提交），并为新 hero 重新拍快照，editing 保持开启。
      if (d.editing && d.currentDepthLabel) {
        const depth = d.depths.find((x) => x.label === d.currentDepthLabel);
        // 切换 hero 后 vs 候选完全变了 → 回到默认/RFI 视图，对应 vsSeatId=null 的快照
        const editSnapshot = depth ? takeEditSnapshot(depth, seatId, null) : null;
        if (editSnapshot) {
          const draft: DraftState = {
            ...d,
            currentSeatId: seatId,
            currentVsSeatId: null,
            editing: true,
            editSnapshot,
          };
          return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
        }
      }
      const base = rollbackEditing(d, s.persisted);
      // 切换 hero 后 vs 候选完全变了 → 回退到默认/RFI 视图
      const draft: DraftState = {
        ...base,
        currentSeatId: seatId,
        currentVsSeatId: null,
      };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  // ====== 对战座位（vs_seat）操作 ======

  /**
   * 切换当前查看的对战座位。
   * - vsSeatId = null → 切回默认/RFI 视图
   * - vsSeatId 非 null → 必须已在 versus[currentSeatId].activeVsSeats 内，否则忽略
   * - 编辑模式下切换：保留已涂色（视为提交），为新目标重新拍快照，editing 保持开启
   * - 非编辑模式：与 switchSeat 一致（rollbackEditing 仅在残留 snapshot 时生效，正常无副作用）
   */
  switchVsSeat(vsSeatId: string | null) {
    setState((s) => {
      const d = s.draft;
      if (!d.rangeId) return s;
      if (d.currentVsSeatId === vsSeatId) return s;
      if (vsSeatId !== null) {
        if (!d.currentSeatId || !d.currentDepthLabel) return s;
        const depth = d.depths.find((x) => x.label === d.currentDepthLabel);
        const group = depth?.versus?.[d.currentSeatId];
        if (!group?.activeVsSeats.includes(vsSeatId)) return s;
      }
      // 编辑模式下切换对战座位：保留当前已涂色（视为提交），并为新 vs 重新拍快照，editing 保持开启。
      if (d.editing && d.currentSeatId && d.currentDepthLabel) {
        const depth = d.depths.find((x) => x.label === d.currentDepthLabel);
        const editSnapshot = depth
          ? takeEditSnapshot(depth, d.currentSeatId, vsSeatId)
          : null;
        if (editSnapshot) {
          const draft: DraftState = {
            ...d,
            currentVsSeatId: vsSeatId,
            editing: true,
            editSnapshot,
          };
          return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
        }
      }
      const base = rollbackEditing(d, s.persisted);
      const draft: DraftState = { ...base, currentVsSeatId: vsSeatId };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 给当前 (depth, hero_seat) 添加一个对战座位，并切换到该 vs 视图。
   * - 仅编辑模式下生效。
   * - vsSeatId 必须是 hero 之外的合法座位（其它情况静默忽略）。
   * - 已存在则只做切换（不重复添加）。
   * - 创建群组：activeVsSeats 按位置序保持有序，primaryVsSeatId 暂不设置（首次涂色时才会写入）。
   */
  addVsSeat(vsSeatId: string) {
    setState((s) => {
      const d = s.draft;
      if (!d.rangeId || !d.editing) return s;
      if (!d.currentDepthLabel || !d.currentSeatId) return s;
      const heroSeatId = d.currentSeatId;
      const others = getOtherSeats(d.seats, heroSeatId) as readonly string[];
      if (!others.includes(vsSeatId)) return s;
      const dIdx = d.depths.findIndex((x) => x.label === d.currentDepthLabel);
      if (dIdx < 0) return s;
      const depth = d.depths[dIdx];
      const versus = depth.versus ?? {};
      const group = versus[heroSeatId];
      if (group?.activeVsSeats.includes(vsSeatId)) {
        // 已存在 → 切到 viewport
        if (d.currentVsSeatId === vsSeatId) return s;
        const base = rollbackEditing(d, s.persisted);
        const draft: DraftState = { ...base, currentVsSeatId: vsSeatId };
        return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
      }
      const baseGroup = group ?? emptyVersusGroup();
      const merged = new Set<string>([...baseGroup.activeVsSeats, vsSeatId]);
      const sortedActive = others.filter((id) => merged.has(id));
      const nextGroup: VersusGroup = { ...baseGroup, activeVsSeats: sortedActive };
      // 添加对战座位是结构性变更：先 rollback 当前编辑（避免 editSnapshot 指向陈旧群组），
      // 再写入新的 depth，最后把视图切到新的 vs。
      const rolled = rollbackEditing(d, s.persisted);
      const depths = rolled.depths.slice();
      depths[dIdx] = {
        ...depths[dIdx],
        versus: { ...(depths[dIdx].versus ?? {}), [heroSeatId]: nextGroup },
      };
      const draft: DraftState = {
        ...rolled,
        depths,
        currentVsSeatId: vsSeatId,
        dirty: true,
      };
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 从当前 (depth, hero_seat) 移除一个对战座位（连同其专属 cells / override）。
   * - 仅编辑模式下生效。
   * - 移除当前正在查看的 vs → 自动切回默认/RFI 视图。
   * - 移除后若群组完全空（无 active、无 cells、无 customActions），直接删除整个群组。
   */
  removeVsSeat(vsSeatId: string) {
    setState((s) => {
      const d = s.draft;
      if (!d.rangeId || !d.editing) return s;
      if (!d.currentDepthLabel || !d.currentSeatId) return s;
      const heroSeatId = d.currentSeatId;
      const dIdx = d.depths.findIndex((x) => x.label === d.currentDepthLabel);
      if (dIdx < 0) return s;
      const depth = d.depths[dIdx];
      const versus = depth.versus;
      const group = versus?.[heroSeatId];
      if (!versus || !group || !group.activeVsSeats.includes(vsSeatId)) return s;

      // 先把当前编辑回滚掉（snapshot 可能指向被删的 vs）
      const rolled = rollbackEditing(d, s.persisted);
      const depthsAfterRollback = rolled.depths;
      const rolledVersus = depthsAfterRollback[dIdx].versus ?? versus;
      const rolledGroup = rolledVersus[heroSeatId] ?? group;

      const nextActive = rolledGroup.activeVsSeats.filter((id) => id !== vsSeatId);
      const nextOverrides = { ...rolledGroup.vsSeatOverrides };
      delete nextOverrides[vsSeatId];
      const nextPrimary =
        rolledGroup.primaryVsSeatId === vsSeatId ? null : rolledGroup.primaryVsSeatId;

      const isGroupEmpty =
        nextActive.length === 0 &&
        Object.keys(rolledGroup.vsSharedCells).length === 0 &&
        rolledGroup.vsSharedCustomActions.length === 0 &&
        Object.keys(nextOverrides).length === 0;

      const newVersus: Record<string, VersusGroup> = { ...rolledVersus };
      if (isGroupEmpty) {
        delete newVersus[heroSeatId];
      } else {
        newVersus[heroSeatId] = {
          ...rolledGroup,
          activeVsSeats: nextActive,
          vsSeatOverrides: nextOverrides,
          primaryVsSeatId: nextPrimary,
        };
      }

      const depths = depthsAfterRollback.slice();
      const newDepth: DepthGrid = { ...depths[dIdx] };
      if (Object.keys(newVersus).length > 0) {
        newDepth.versus = newVersus;
      } else {
        delete newDepth.versus;
      }
      depths[dIdx] = newDepth;

      const currentVsSeatId =
        rolled.currentVsSeatId === vsSeatId ? null : rolled.currentVsSeatId;
      const draft: DraftState = {
        ...rolled,
        depths,
        currentVsSeatId,
        dirty: true,
      };
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
        s.persisted.lastOpenedVsSeatId,
      );
      return { ...s, draft, persisted: bumpLastOpened(draft, s.persisted) };
    });
  },

  /**
   * 强制把当前 draft 落盘（含编辑模式中的涂色）。
   * 在自动保存模式下基本无人调用，仅供未来手动保存快捷键 / 极端兜底使用。
   * 若 rangeId 为空则不操作。
   */
  save() {
    setState((s) => {
      if (!s.draft.rangeId) return s;
      const committed = commitEditing(s.draft);
      // 强制 dirty=true，让 setState 包装中的 autoCommit 完成落盘
      return { ...s, draft: { ...committed, dirty: true } };
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
        base.currentVsSeatId,
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

  /**
   * 把指定 range 序列化为带信封的 JSON 字符串。
   * - 信封含 type / version / exportedAt，便于以后向后兼容
   * - 找不到 id 时返回 null
   */
  exportRangeToJSON(id: string): { json: string; name: string } | null {
    const src = state.persisted.ranges.find((r) => r.id === id);
    if (!src) return null;
    const envelope: ExportEnvelope = {
      type: EXPORT_TYPE,
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      range: {
        ...src,
        depths: src.depths.map(cloneDepth),
        notes: { ...(src.notes ?? {}) },
      },
    };
    return { json: JSON.stringify(envelope, null, 2), name: src.name || 'Untitled' };
  },

  /**
   * 从外部 JSON 字符串导入一个 range。
   * - 同时支持「信封格式」与「裸 RangeDoc」
   * - 总是分配新的 id（避免覆盖远端同步同 id 数据）
   * - 若与现有方案重名，自动追加「（导入）」后缀；再撞继续递增编号
   * - createdAt/updatedAt 使用导入时刻，保证排序在最前 & 触发 sync push
   * - 不激活；调用方可拿到 id 后再决定是否 openRange
   */
  importRangeFromJSON(raw: string): ImportResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: '文件内容不是合法 JSON' };
    }

    let candidate: unknown = parsed;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (obj.type === EXPORT_TYPE && obj.range) candidate = obj.range;
    }
    if (candidate && typeof candidate === 'object') {
      const obj = { ...(candidate as Record<string, unknown>) };
      const now = Date.now();
      if (typeof obj.id !== 'string') obj.id = `imp_${now}`;
      if (typeof obj.createdAt !== 'number') obj.createdAt = now;
      if (typeof obj.updatedAt !== 'number') obj.updatedAt = now;
      candidate = obj;
    }

    const sanitized = sanitizeRangeDoc(candidate);
    if (!sanitized) return { ok: false, error: '文件结构不符合 HRM 范围方案格式' };

    let outId = '';
    let outName = '';
    setState((s) => {
      const used = new Set(s.persisted.ranges.map((r) => r.name));
      const base = (sanitized.name || 'Untitled').trim() || 'Untitled';
      let name = base;
      if (used.has(name)) {
        name = `${base}（导入）`;
        let i = 2;
        while (used.has(name)) {
          name = `${base}（导入 ${i}）`;
          i++;
        }
      }
      const now = Date.now();
      const range: RangeDoc = {
        ...sanitized,
        id: newId(),
        name,
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      outName = name;
      return {
        ...s,
        persisted: { ...s.persisted, ranges: [range, ...s.persisted.ranges] },
      };
    });
    return { ok: true, id: outId, name: outName };
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
      const after = applyAtCurrentScope(s, ({ cells, customActions }) => {
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
      const after = applyAtCurrentScope(s, ({ cells, customActions }) => {
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
      const after = applyAtCurrentScope(s, ({ cells, customActions }) => {
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
