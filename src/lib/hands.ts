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

/**
 * 把一个 hand key 反解为 (row, col)（与 `cellKey` 互逆）：
 * - "AA"  → (0, 0)
 * - "AKs" → (0, 1)  // suited 在对角线右上：row=高 rank, col=低 rank
 * - "AKo" → (1, 0)  // offsuit 在对角线左下：row=低 rank, col=高 rank
 * 非法输入返回 null。
 */
export function parseHand(hand: string): { row: number; col: number } | null {
  if (hand.length === 2) {
    const i = RANKS.indexOf(hand[0] as Rank);
    if (i < 0 || hand[0] !== hand[1]) return null;
    return { row: i, col: i };
  }
  if (hand.length === 3) {
    const a = RANKS.indexOf(hand[0] as Rank);
    const b = RANKS.indexOf(hand[1] as Rank);
    if (a < 0 || b < 0 || a === b) return null;
    const suffix = hand[2];
    if (suffix === 's' && a < b) return { row: a, col: b };
    if (suffix === 'o' && a < b) return { row: b, col: a };
  }
  return null;
}

/**
 * 给定两个 hand，返回它们在 13×13 网格上构成的矩形里所有 hand key。
 * 输入顺序不敏感（min/max 自动对齐）；任一非法输入返回空数组。
 */
export function rectHands(a: HandKey, b: HandKey): HandKey[] {
  const pa = parseHand(a);
  const pb = parseHand(b);
  if (!pa || !pb) return [];
  const r1 = Math.min(pa.row, pb.row);
  const r2 = Math.max(pa.row, pb.row);
  const c1 = Math.min(pa.col, pb.col);
  const c2 = Math.max(pa.col, pb.col);
  const out: HandKey[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      out.push(cellKey(r, c));
    }
  }
  return out;
}
