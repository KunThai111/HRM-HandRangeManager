import { useSyncExternalStore } from 'react';
import type { Action } from '@/lib/colors';
import { ALL_HAND_KEYS } from '@/lib/hands';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
} from '@/lib/depths';
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
 * 编辑模式（§3.8）：
 * - editing=false 时网格的单格涂色（paintCell）不会改动 cells。
 * - beginEdit() 拍下当前激活深度的 cells 快照到 editSnapshot；
 *   confirmEdit() 退出编辑模式但保留涂色；
 *   cancelEdit() 把快照写回当前 depth.cells 并重算 dirty。
 */
export interface EditSnapshot {
  label: string;
  cells: Record<string, Action>;
}

export interface DraftState {
  rangeId: string | null;
  name: string;
  seats: number;
  depths: DepthGrid[];
  currentDepthLabel: string | null;
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
  currentDepthLabel: null,
  dirty: false,
  editing: false,
  editSnapshot: null,
};

function draftFromRange(range: RangeDoc, preferLabel: string | null): DraftState {
  const depths = range.depths.map((d) => ({ label: d.label, cells: { ...d.cells } }));
  const label =
    preferLabel && depths.some((d) => d.label === preferLabel)
      ? preferLabel
      : depths[0]?.label ?? null;
  return {
    rangeId: range.id,
    name: range.name,
    seats: clampSeats(range.seats),
    depths,
    currentDepthLabel: label,
    dirty: false,
    editing: false,
    editSnapshot: null,
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

function draftMatchesPersisted(draft: DraftState, persisted: PersistedState): boolean {
  if (!draft.rangeId) return true;
  const src = persisted.ranges.find((r) => r.id === draft.rangeId);
  if (!src) return false;
  if (src.name !== draft.name) return false;
  if (src.seats !== draft.seats) return false;
  if (src.depths.length !== draft.depths.length) return false;
  for (let i = 0; i < src.depths.length; i++) {
    const a = src.depths[i];
    const b = draft.depths[i];
    if (a.label !== b.label) return false;
    if (!cellsEqual(a.cells, b.cells)) return false;
  }
  return true;
}

function buildInitialState(): InternalState {
  const persisted = loadState();
  const target = persisted.lastOpenedRangeId
    ? persisted.ranges.find((r) => r.id === persisted.lastOpenedRangeId)
    : undefined;
  const draft = target
    ? draftFromRange(target, persisted.lastOpenedDepthLabel)
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

export const EMPTY_CELLS: Record<string, Action> = Object.freeze({});

export function getCurrentDepthCells(draft: DraftState): Record<string, Action> {
  if (!draft.currentDepthLabel) return EMPTY_CELLS;
  return draft.depths.find((x) => x.label === draft.currentDepthLabel)?.cells ?? EMPTY_CELLS;
}

// -------------------- Internal helpers --------------------

function updateCurrentDepth(
  draft: DraftState,
  mutator: (cells: Record<string, Action>) => Record<string, Action>,
): DraftState {
  if (!draft.currentDepthLabel) return draft;
  const idx = draft.depths.findIndex((d) => d.label === draft.currentDepthLabel);
  if (idx < 0) return draft;
  const cur = draft.depths[idx];
  const nextCells = mutator(cur.cells);
  if (nextCells === cur.cells) return draft;
  const depths = draft.depths.slice();
  depths[idx] = { label: cur.label, cells: nextCells };
  return { ...draft, depths, dirty: true };
}

function bumpLastOpened(draft: DraftState, persisted: PersistedState): PersistedState {
  return {
    ...persisted,
    lastOpenedRangeId: draft.rangeId,
    lastOpenedDepthLabel: draft.currentDepthLabel,
  };
}

// -------------------- 编辑模式辅助 --------------------

/**
 * 把编辑模式的 snapshot 应用回当前 depth.cells，并清除 editing/editSnapshot。
 * 如果回滚后 draft 与 persisted 完全一致，则同时清除 dirty 标记。
 * 没有进入编辑模式 / 没有 snapshot / 没激活范围时直接返回原 draft。
 */
function rollbackEditing(draft: DraftState, persisted: PersistedState): DraftState {
  if (!draft.editing && !draft.editSnapshot) return draft;
  const snap = draft.editSnapshot;
  let depths = draft.depths;
  if (snap) {
    const idx = depths.findIndex((d) => d.label === snap.label);
    if (idx >= 0) {
      const next = depths.slice();
      next[idx] = { label: snap.label, cells: { ...snap.cells } };
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
      if (!d.rangeId || !d.currentDepthLabel) return s;
      if (d.editing) return s;
      const cur = d.depths.find((x) => x.label === d.currentDepthLabel);
      if (!cur) return s;
      const editSnapshot: EditSnapshot = {
        label: cur.label,
        cells: { ...cur.cells },
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
      const draft = updateCurrentDepth(s.draft, (cells) => {
        const prev = cells[hand] ?? 'fold';
        if (prev === action) return cells;
        const next = { ...cells };
        if (action === 'fold') delete next[hand];
        else next[hand] = action;
        return next;
      });
      if (draft === s.draft) return s;
      return { ...s, draft };
    });
  },

  fillAll(action: Action) {
    setState((s) => {
      const draft = updateCurrentDepth(s.draft, () => {
        if (action === 'fold') return {};
        const out: Record<string, Action> = {};
        for (const k of ALL_HAND_KEYS) out[k] = action;
        return out;
      });
      if (draft === s.draft) return s;
      return { ...s, draft };
    });
  },

  clearAll() {
    this.fillAll('fold');
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
      return { ...s, draft: { ...s.draft, seats: next, dirty: true } };
    });
  },

  // ====== Depth 切换 ======
  switchDepth(label: string) {
    setState((s) => {
      if (s.draft.currentDepthLabel === label) return s;
      if (!s.draft.depths.some((d) => d.label === label)) return s;
      const base = rollbackEditing(s.draft, s.persisted);
      const draft: DraftState = { ...base, currentDepthLabel: label };
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
      const depths = newDepths.map((d) => ({ label: d.label, cells: { ...d.cells } }));
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
      const draft = draftFromRange(range, range.depths[0]?.label ?? null);
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
      // 切换范围视为丢弃本次编辑会话；draftFromRange 已重置 editing/editSnapshot
      const draft = draftFromRange(found, s.persisted.lastOpenedDepthLabel);
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
              depths: base.depths.map((d) => ({ label: d.label, cells: { ...d.cells } })),
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
        depths: base.depths.map((d) => ({ label: d.label, cells: { ...d.cells } })),
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      const draft = draftFromRange(range, base.currentDepthLabel);
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
        depths: src.depths.map((d) => ({ label: d.label, cells: { ...d.cells } })),
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
};

// 出厂模板常量供 UI 复用（如"重置为出厂模板"按钮，可选）
export { DEFAULT_DEPTH_LABELS };
