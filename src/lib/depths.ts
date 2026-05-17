import type { Action, CustomAction } from './colors';

/**
 * 一个深度下「(座位)」对应的独立 cells / customActions 副本。
 *
 * - `cells` / `customActions` 是该座位完全独立的版本；
 *   一旦座位独立后，shared 的修改不再影响它，它的修改也不再写回 shared。
 */
export interface SeatOverride {
  cells: Record<string, Action>;
  customActions: CustomAction[];
}

/**
 * 一个深度下的范围数据。
 *
 * 模型（座位间「跟随 / 独立」）：
 * - `sharedCells` / `sharedCustomActions`：「跟随」类座位共同看到 / 编辑的内容。
 * - `seatOverrides[seatId]`：已独立座位的私有内容；存在 → 该座位独立。
 * - `primarySeatId`：第一个对该深度做出修改的座位。
 *    - null = 还没有任何编辑发生；首次编辑会把它设为当前座位，并写入 shared。
 *    - 等于当前编辑座位 → 仍写 shared（让其它「跟随」座位感受到改动）。
 *    - 等于其它座位 → 当前座位是「跟随者」，第一次写入会 COW 到 seatOverrides[当前座位]。
 *
 * 规约：
 * - `sharedCells` / `seatOverrides[*].cells` 中只保存「非 fold」格子；空 fold 不入库。
 * - 若一个 depth 完全空（shared 与 overrides 全部为空，且 customActions 也为空），仍保留以维持 label。
 */
export interface DepthGrid {
  label: string;
  sharedCells: Record<string, Action>;
  sharedCustomActions: CustomAction[];
  seatOverrides: Record<string, SeatOverride>;
  primarySeatId: string | null;
}

export const DEFAULT_DEPTH_LABELS: readonly string[] = [
  '100bb',
  '60bb',
  '40bb',
  '30bb',
  '20bb',
];

export function emptyDepth(label: string): DepthGrid {
  return {
    label,
    sharedCells: {},
    sharedCustomActions: [],
    seatOverrides: {},
    primarySeatId: null,
  };
}

export function emptyOverride(): SeatOverride {
  return { cells: {}, customActions: [] };
}

/** 该座位是否已经在该 depth 下独立。 */
export function isSeatIndependent(depth: DepthGrid, seatId: string): boolean {
  return Object.prototype.hasOwnProperty.call(depth.seatOverrides, seatId);
}

/**
 * 该座位「当前可编辑的目标范围」是 shared 还是它自己的 override：
 * - 已独立 → 'override'
 * - 未独立 + 是 primary（或还没人独占 primary）→ 'shared'
 * - 未独立 + primary 是别人 → 'follower'（任何写入都会触发 COW 到 override）
 */
export function seatScope(
  depth: DepthGrid,
  seatId: string,
): 'override' | 'shared' | 'follower' {
  if (isSeatIndependent(depth, seatId)) return 'override';
  if (depth.primarySeatId == null || depth.primarySeatId === seatId) return 'shared';
  return 'follower';
}

/** 该座位查看时应该看到的 cells（独立 → 自己的；否则 → shared）。 */
export function getCellsForSeat(
  depth: DepthGrid,
  seatId: string,
): Record<string, Action> {
  const o = depth.seatOverrides[seatId];
  return o ? o.cells : depth.sharedCells;
}

/** 该座位查看时应该看到的 customActions（独立 → 自己的；否则 → shared）。 */
export function getCustomActionsForSeat(
  depth: DepthGrid,
  seatId: string,
): CustomAction[] {
  const o = depth.seatOverrides[seatId];
  return o ? o.customActions : depth.sharedCustomActions;
}

export function depthsFromLabels(labels: readonly string[]): DepthGrid[] {
  return labels.map((l) => emptyDepth(l));
}

/**
 * 检查标签数组内是否有重复。重复时返回首个冲突的下标对，否则返回 null。
 * 用字符串比较（区分大小写）。
 */
export function findDuplicateLabel(labels: string[]): { a: number; b: number } | null {
  const seen = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i];
    if (seen.has(v)) return { a: seen.get(v) as number, b: i };
    seen.set(v, i);
  }
  return null;
}

/**
 * 在某个 depths 集合中，校验新标签是否唯一（可排除 ignoreIndex 自身位置）。
 */
export function isLabelUnique(
  labels: readonly string[],
  candidate: string,
  ignoreIndex: number = -1,
): boolean {
  for (let i = 0; i < labels.length; i++) {
    if (i === ignoreIndex) continue;
    if (labels[i] === candidate) return false;
  }
  return true;
}

export function countNonFold(cells: Record<string, Action>): number {
  let n = 0;
  for (const v of Object.values(cells)) if (v !== 'fold') n += 1;
  return n;
}

/**
 * 一个深度的「独有数据点」总数：sharedCells + 各 seatOverrides 的 cells。
 * 用于深度编辑弹窗显示「该深度有多少标记」。
 */
export function countDepthMarks(depth: DepthGrid): number {
  let n = Object.keys(depth.sharedCells).length;
  for (const o of Object.values(depth.seatOverrides)) {
    n += Object.keys(o.cells).length;
  }
  return n;
}
