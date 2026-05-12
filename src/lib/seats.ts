/**
 * 座位（位置）维度。
 *
 * - 座位 id 用稳定字符串，UTG+1 / UTG+2 简写为 U1 / U2。
 * - 按桌人数（seats）从 UTG 一直到 BB 截断出实际存在的座位序列。
 * - 截断规则参考用户约定：
 *   - 9 人：UTG, U1, U2, LJ, HJ, CO, BTN, SB, BB
 *   - 8 人：UTG, U1,     LJ, HJ, CO, BTN, SB, BB
 *   - 7 人：UTG,         LJ, HJ, CO, BTN, SB, BB
 *   - 6 人：UTG,             HJ, CO, BTN, SB, BB
 *   - 5 人：                 HJ, CO, BTN, SB, BB
 *   - 4 人：                     CO, BTN, SB, BB
 *   - 3 人：                         BTN, SB, BB
 *   - 2 人：                              SB, BB
 */

export const ALL_SEAT_IDS = [
  'UTG',
  'U1',
  'U2',
  'LJ',
  'HJ',
  'CO',
  'BTN',
  'SB',
  'BB',
] as const;

export type SeatId = (typeof ALL_SEAT_IDS)[number];

const SEATS_BY_COUNT: Record<number, readonly SeatId[]> = {
  9: ['UTG', 'U1', 'U2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'U1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
  4: ['CO', 'BTN', 'SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  2: ['SB', 'BB'],
};

export function seatsForCount(count: number): readonly SeatId[] {
  return SEATS_BY_COUNT[count] ?? SEATS_BY_COUNT[9];
}

export function isValidSeatId(value: unknown): value is SeatId {
  return typeof value === 'string' && (ALL_SEAT_IDS as readonly string[]).includes(value);
}

/** 显示用全称（用于 tooltip）。按钮上直接显示 SeatId（UTG / U1 / U2 / ...）。 */
export const SEAT_FULL_LABEL: Record<SeatId, string> = {
  UTG: 'Under The Gun',
  U1: 'UTG+1',
  U2: 'UTG+2',
  LJ: 'Lojack',
  HJ: 'Hijack',
  CO: 'Cutoff',
  BTN: 'Button',
  SB: 'Small Blind',
  BB: 'Big Blind',
};

/** 给定 seats 数与候选 id，返回该 id 是否落在当前桌的座位序列内。 */
export function seatExistsInCount(seatId: string, count: number): boolean {
  return (seatsForCount(count) as readonly string[]).includes(seatId);
}
