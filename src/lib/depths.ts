import type { Action } from './colors';

/**
 * 一份「(深度, 英雄座位)」下的范围数据：
 *
 * - `overall` 是「总体范围」：当用户在「对战」行里没选具体对战座位时显示/编辑的那张表。
 * - `vs[opponentId]` 是「针对该对战座位的独立范围」。规则：
 *    1. 若 `vs[opp]` 不存在 → 显示时回退到 `overall`（视为继承）。
 *    2. 用户对该对战做出第一笔涂色时，按 copy-on-write 把 `overall` 浅拷贝到 `vs[opp]`，
 *       然后才在 `vs[opp]` 上写入新动作；之后该对战与总体彻底独立。
 *
 * 规约：
 * - `overall` / `vs[*]` 中只保存「非 fold」的格子；空 fold 不入库。
 * - 若一个 SeatBucket 的 overall 与所有 vs[*] 都为空，外层 `seats[seatId]` 字段直接不出现。
 */
export interface SeatBucket {
  overall: Record<string, Action>;
  vs: Record<string, Record<string, Action>>;
}

/**
 * 一个深度对应多张范围表，每张属于一个英雄座位。
 *
 * `seats` 字典 key 是英雄座位 id（见 `lib/seats.ts`），value 是 SeatBucket（见上）。
 * 没有任何涂色的 (depth, heroSeat) 不会出现在 `seats` 中。
 */
export interface DepthGrid {
  label: string;
  seats: Record<string, SeatBucket>;
}

export const DEFAULT_DEPTH_LABELS: readonly string[] = [
  '100bb',
  '60bb',
  '40bb',
  '30bb',
  '20bb',
];

export function emptyDepth(label: string): DepthGrid {
  return { label, seats: {} };
}

export function emptyBucket(): SeatBucket {
  return { overall: {}, vs: {} };
}

/** Bucket 是否完全空（overall 为空且无任何独立 vs）。 */
export function isBucketEmpty(b: SeatBucket | undefined): boolean {
  if (!b) return true;
  if (Object.keys(b.overall).length > 0) return false;
  for (const k of Object.keys(b.vs)) {
    if (Object.keys(b.vs[k]).length > 0) return false;
  }
  return true;
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
 * 取 (heroSeat, opponent) 在某 SeatBucket 下应当渲染的 cells：
 * - opponent = null → overall
 * - vs[opponent] 存在 → vs[opponent]
 * - vs[opponent] 不存在 → 回退到 overall（继承显示，不修改 vs）
 */
export function bucketCellsFor(
  bucket: SeatBucket | undefined,
  opponentId: string | null,
): Record<string, Action> {
  if (!bucket) return {};
  if (opponentId == null) return bucket.overall;
  return bucket.vs[opponentId] ?? bucket.overall;
}

/** 该对战是否已与总体独立（即 vs[opp] 中确实存在条目）。 */
export function isOpponentIndependent(
  bucket: SeatBucket | undefined,
  opponentId: string,
): boolean {
  return !!bucket && Object.prototype.hasOwnProperty.call(bucket.vs, opponentId);
}

/**
 * 统计一个 DepthGrid 下所有 (heroSeat, overall + 各 vs) 的非 fold 格子数总和。
 * 用于深度编辑弹窗的总标记数显示。
 */
export function countDepthMarks(depth: DepthGrid): number {
  let n = 0;
  for (const bucket of Object.values(depth.seats)) {
    n += Object.keys(bucket.overall).length;
    for (const cells of Object.values(bucket.vs)) {
      n += Object.keys(cells).length;
    }
  }
  return n;
}
