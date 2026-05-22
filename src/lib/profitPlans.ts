/**
 * 主要盈利计划（ProfitPlan）领域模型。
 *
 * 设计要点：
 * - 计划与比赛通过「时间区间」隐式关联：比赛的 `displayDate(t)` 落在
 *   `[startDate 00:00, endDate 23:59]` 区间内，即归属该计划。
 * - 目标金额固定 USD（targetUSD），区间内累计净盈亏也折算为 USD：
 *   achievedUSD = Σ toUSD(totalEarning(t) − t.buyIn, t.currency)
 * - 同一时间段允许多个计划并行（区间可重叠），由 UI 层翻页选择展示。
 */
import {
  displayTimestamp,
  toUSD,
  totalEarning,
  type Tournament,
} from './tournaments';

export interface ProfitPlan {
  id: string;
  /** 计划名（可选）。为空时 UI 展示 "YYYY/MM/DD – YYYY/MM/DD"。 */
  name?: string;
  /** 起始日（本地日历日，YYYY-MM-DD，含两端）。 */
  startDate: string;
  /** 结束日（本地日历日，YYYY-MM-DD，含两端）。 */
  endDate: string;
  /** 目标盈利金额，USD。 */
  targetUSD: number;
  note?: string;
  /** ISO 字符串，与 Tournament 保持一致风格。 */
  createdAt: string;
  /** 最后修改时间（ms epoch）。预留给后续 LWW 同步使用。 */
  updatedAt: number;
}

export type ProfitPlanState = 'upcoming' | 'ongoing' | 'ended';

export interface ProfitPlanProgress {
  /** 区间内累计净盈亏（可负），USD。 */
  achievedUSD: number;
  /** achievedUSD / targetUSD；targetUSD <= 0 时返回 0。可大于 1 / 小于 0。 */
  ratio: number;
  /** 落在区间内的比赛数。 */
  matchedCount: number;
  /** 相对今天的状态。 */
  state: ProfitPlanState;
  /**
   * 距「结束日 23:59」的剩余天数（向上取整）。
   * - ongoing / upcoming：剩余天数（>=0）。
   * - ended：自结束日算起的「已结束 N 天」（>=0，值为正）。
   * UI 根据 state 决定文案。
   */
  daysLeft: number;
}

/** 把 YYYY-MM-DD 解析为本地当日 00:00 的 timestamp；失败返回 NaN。 */
function startOfDayTs(dateStr: string): number {
  if (!dateStr) return NaN;
  // 显式按本地时区构造，避免 `new Date('2026-05-01')` 被解析为 UTC 0 点。
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return dt.getTime();
}

/** 把 YYYY-MM-DD 解析为本地当日 23:59:59.999 的 timestamp；失败返回 NaN。 */
function endOfDayTs(dateStr: string): number {
  if (!dateStr) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return dt.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 计算 a 日 0 点到 b 日 0 点之间相差的整数天数（b - a）。允许负值。 */
function diffDays(aTs: number, bTs: number): number {
  return Math.round((bTs - aTs) / DAY_MS);
}

/** 取「今天 00:00」的 timestamp，作为状态/剩余天数比较基准。 */
function todayStartTs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computePlanProgress(
  plan: ProfitPlan,
  tournaments: Tournament[],
): ProfitPlanProgress {
  const lo = startOfDayTs(plan.startDate);
  const hi = endOfDayTs(plan.endDate);

  let achievedUSD = 0;
  let matchedCount = 0;
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) {
    for (const t of tournaments) {
      const ts = displayTimestamp(t);
      if (ts >= lo && ts <= hi) {
        const profit = totalEarning(t) - t.buyIn;
        achievedUSD += toUSD(profit, t.currency);
        matchedCount += 1;
      }
    }
  }

  const target = Number.isFinite(plan.targetUSD) ? plan.targetUSD : 0;
  const ratio = target > 0 ? achievedUSD / target : 0;

  const today = todayStartTs();
  const startDayTs = Number.isFinite(lo) ? lo : today;
  const endDayTs = Number.isFinite(hi)
    ? // hi 是当日 23:59:59.999，归一到当日 0 点便于天数差计算
      startOfDayTs(plan.endDate)
    : today;

  let state: ProfitPlanState;
  let daysLeft: number;
  if (today < startDayTs) {
    state = 'upcoming';
    daysLeft = diffDays(today, endDayTs);
  } else if (today > endDayTs) {
    state = 'ended';
    daysLeft = diffDays(endDayTs, today);
  } else {
    state = 'ongoing';
    daysLeft = diffDays(today, endDayTs);
  }

  return { achievedUSD, ratio, matchedCount, state, daysLeft };
}

/** UI 用：把 YYYY-MM-DD 渲染为 "YYYY/MM/DD"；非法日期原样返回。 */
export function formatPlanDate(d: string): string {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(d)) return d;
  return d.replace(/-/g, '/');
}

/** UI 用：构造计划标题 "YYYY/MM/DD – YYYY/MM/DD"。 */
export function planDisplayName(plan: ProfitPlan): string {
  return `${formatPlanDate(plan.startDate)} – ${formatPlanDate(plan.endDate)}`;
}
