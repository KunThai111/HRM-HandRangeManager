import { useSyncExternalStore } from 'react';
import type { Action } from '@/lib/colors';
import { ALL_HAND_KEYS } from '@/lib/hands';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
} from '@/lib/depths';
import {
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
 */
export interface DraftState {
  rangeId: string | null;
  name: string;
  depths: DepthGrid[];
  currentDepthLabel: string | null;
  dirty: boolean;
}

interface InternalState {
  persisted: PersistedState;
  draft: DraftState;
}

const EMPTY_DRAFT: DraftState = {
  rangeId: null,
  name: '',
  depths: [],
  currentDepthLabel: null,
  dirty: false,
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
    depths,
    currentDepthLabel: label,
    dirty: false,
  };
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

// -------------------- Actions --------------------

export const rangeActions = {
  // ====== 涂色 ======
  paintCell(hand: string, action: Action) {
    setState((s) => {
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

  // ====== Depth 切换 ======
  switchDepth(label: string) {
    setState((s) => {
      if (s.draft.currentDepthLabel === label) return s;
      if (!s.draft.depths.some((d) => d.label === label)) return s;
      const draft: DraftState = { ...s.draft, currentDepthLabel: label };
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
      const depths = newDepths.map((d) => ({ label: d.label, cells: { ...d.cells } }));
      const stillHas = depths.some((d) => d.label === s.draft.currentDepthLabel);
      const draft: DraftState = {
        ...s.draft,
        depths,
        currentDepthLabel: stillHas ? s.draft.currentDepthLabel : depths[0]?.label ?? null,
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
  newRange(name: string): string {
    let outId = '';
    setState((s) => {
      const range = makeRange(name, s.persisted.defaultDepthLabels);
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
      const now = Date.now();
      const name = s.draft.name.trim() || 'Untitled';
      const ranges = s.persisted.ranges.map((r) =>
        r.id === s.draft.rangeId
          ? {
              ...r,
              name,
              depths: s.draft.depths.map((d) => ({ label: d.label, cells: { ...d.cells } })),
              updatedAt: now,
            }
          : r,
      );
      const draft: DraftState = { ...s.draft, name, dirty: false };
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
      const finalName = name.trim() || `${s.draft.name || 'Untitled'} (copy)`;
      const now = Date.now();
      const range: RangeDoc = {
        id: newId(),
        name: finalName,
        depths: s.draft.depths.map((d) => ({ label: d.label, cells: { ...d.cells } })),
        createdAt: now,
        updatedAt: now,
      };
      outId = range.id;
      const draft = draftFromRange(range, s.draft.currentDepthLabel);
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
