import type { Action } from './colors';

export interface DepthGrid {
  label: string;
  cells: Record<string, Action>;
}

export const DEFAULT_DEPTH_LABELS: readonly string[] = [
  '100bb',
  '60bb',
  '40bb',
  '30bb',
  '20bb',
];

export function emptyDepth(label: string): DepthGrid {
  return { label, cells: {} };
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
