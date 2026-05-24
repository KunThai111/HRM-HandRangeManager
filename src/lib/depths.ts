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
 * 一个 (depth, hero_seat) 下「对战座位维度」的数据集。
 *
 * 在 hero=X 视图下，用户可以为任意"非自身座位"（vs_seat ≠ X）添加专属表格。
 * 这些对战座位之间复用与 hero 维度同款的 shared+override 模型：
 * - `vsSharedCells` / `vsSharedCustomActions`：未独立的对战座位共看的内容。
 * - `vsSeatOverrides[vsSeatId]`：已独立的对战座位的私有副本。
 * - `primaryVsSeatId`：本群组里第一个对其做出修改的对战座位（null = 还没人改）。
 * - `activeVsSeats`：用户显式添加的对战座位列表，按位置序排（决定 UI 出现顺序）。
 *   一个对战座位"存在 UI 上 ↔ 落在 activeVsSeats 里"；删除即从此数组移除并同时清掉 override。
 *
 * 不变式：activeVsSeats 中的每个 id 都必须是当前桌座位序列中、且 ≠ hero 的合法座位（由调用方保证）。
 */
export interface VersusGroup {
  activeVsSeats: string[];
  vsSharedCells: Record<string, Action>;
  vsSharedCustomActions: CustomAction[];
  vsSeatOverrides: Record<string, SeatOverride>;
  primaryVsSeatId: string | null;
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
 * 上述字段都是「vs_seat = null（默认/开池/RFI）」视图的数据。
 *
 * - `versus[heroSeatId]`：可选。该 hero 座位下的对战座位数据集（见 VersusGroup）。
 *   缺失 → 该 hero 还没有任何对战座位；这是默认状态。
 *   现有数据天然兼容（旧文档没有 versus 字段就是默认）。
 *
 * 规约：
 * - `sharedCells` / `seatOverrides[*].cells` / `vsSharedCells` / `vsSeatOverrides[*].cells`
 *   中只保存「非 fold」格子；空 fold 不入库。
 * - 若一个 depth 完全空（shared 与 overrides 全部为空，且 customActions 也为空），仍保留以维持 label。
 */
export interface DepthGrid {
  label: string;
  sharedCells: Record<string, Action>;
  sharedCustomActions: CustomAction[];
  seatOverrides: Record<string, SeatOverride>;
  primarySeatId: string | null;
  versus?: Record<string, VersusGroup>;
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

export function emptyVersusGroup(): VersusGroup {
  return {
    activeVsSeats: [],
    vsSharedCells: {},
    vsSharedCustomActions: [],
    vsSeatOverrides: {},
    primaryVsSeatId: null,
  };
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

// -------------------- 对战座位维度（vs_seat） --------------------

/** 取 hero 座位下的 VersusGroup；不存在返回 undefined（不会创建）。 */
export function getVersusGroup(
  depth: DepthGrid,
  heroSeatId: string,
): VersusGroup | undefined {
  return depth.versus?.[heroSeatId];
}

/** 该 hero 座位已添加的对战座位（按已存的顺序返回；不存在返回空数组）。 */
export function getActiveVsSeats(depth: DepthGrid, heroSeatId: string): string[] {
  return depth.versus?.[heroSeatId]?.activeVsSeats ?? [];
}

/** 该 hero 座位下，指定 vs 座位是否已经"独立"（拥有自己的 override）。 */
export function isVsSeatIndependent(
  depth: DepthGrid,
  heroSeatId: string,
  vsSeatId: string,
): boolean {
  const g = depth.versus?.[heroSeatId];
  if (!g) return false;
  return Object.prototype.hasOwnProperty.call(g.vsSeatOverrides, vsSeatId);
}

/**
 * 对战座位的写入作用域（与 seatScope 语义对偶，作用维度换成 vs_seat）：
 * - 群组缺失 → 'shared'（首次写入会创建群组并把当前 vs 设为 primary）
 * - 已独立 → 'override'
 * - 未独立 + 是 primary（或还没人是 primary）→ 'shared'
 * - 未独立 + primary 是别的对战 → 'follower'（任何写入都会 COW 到 vsSeatOverrides）
 */
export function vsSeatScope(
  depth: DepthGrid,
  heroSeatId: string,
  vsSeatId: string,
): 'override' | 'shared' | 'follower' {
  const g = depth.versus?.[heroSeatId];
  if (!g) return 'shared';
  if (isVsSeatIndependent(depth, heroSeatId, vsSeatId)) return 'override';
  if (g.primaryVsSeatId == null || g.primaryVsSeatId === vsSeatId) return 'shared';
  return 'follower';
}

/** 该 (hero, vs) 视图应该渲染的 cells（独立 → 自己的；否则 → vsShared）。群组缺失时返回空。 */
export function getCellsForVs(
  depth: DepthGrid,
  heroSeatId: string,
  vsSeatId: string,
): Record<string, Action> {
  const g = depth.versus?.[heroSeatId];
  if (!g) return {};
  const o = g.vsSeatOverrides[vsSeatId];
  return o ? o.cells : g.vsSharedCells;
}

/** 该 (hero, vs) 视图应该渲染的 customActions。群组缺失时返回空数组。 */
export function getCustomActionsForVs(
  depth: DepthGrid,
  heroSeatId: string,
  vsSeatId: string,
): CustomAction[] {
  const g = depth.versus?.[heroSeatId];
  if (!g) return [];
  const o = g.vsSeatOverrides[vsSeatId];
  return o ? o.customActions : g.vsSharedCustomActions;
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
 * 一个深度的「独有数据点」总数：sharedCells + 各 seatOverrides 的 cells +
 * 每个 hero 下 versus 群组的 vsSharedCells + vsSeatOverrides 的 cells。
 * 用于深度编辑弹窗显示「该深度有多少标记」。
 */
export function countDepthMarks(depth: DepthGrid): number {
  let n = Object.keys(depth.sharedCells).length;
  for (const o of Object.values(depth.seatOverrides)) {
    n += Object.keys(o.cells).length;
  }
  if (depth.versus) {
    for (const g of Object.values(depth.versus)) {
      n += Object.keys(g.vsSharedCells).length;
      for (const o of Object.values(g.vsSeatOverrides)) {
        n += Object.keys(o.cells).length;
      }
    }
  }
  return n;
}
