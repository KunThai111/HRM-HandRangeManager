export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

export type Rank = (typeof RANKS)[number];

export type HandKey = string;

/**
 * 根据网格坐标 (row, col) 生成单元格 key。
 * row / col 均使用 RANKS 的索引（0=A, 12=2）。
 * - row === col → 对子（如 "AA"）
 * - row < col  → 同花，对角线右上（如 "AKs"）
 * - row > col  → 非同花，对角线左下（如 "AKo"）
 */
export function cellKey(row: number, col: number): HandKey {
  const r = RANKS[row];
  const c = RANKS[col];
  if (row === col) return `${r}${r}`;
  if (row < col) return `${r}${c}s`;
  return `${c}${r}o`;
}

export const ALL_HAND_KEYS: HandKey[] = (() => {
  const keys: HandKey[] = [];
  for (let r = 0; r < RANKS.length; r++) {
    for (let c = 0; c < RANKS.length; c++) {
      keys.push(cellKey(r, c));
    }
  }
  return keys;
})();

export const TOTAL_CELLS = ALL_HAND_KEYS.length;
