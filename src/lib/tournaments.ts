/**
 * 比赛（Tournament）记录的领域类型与汇总工具。
 *
 * 字段含义：
 * - id: 内部唯一 id。
 * - name: 比赛名（必填）。
 * - iconId: 图标库 id；初版用占位 emoji，后续替换为图片资源。
 * - currency: 比赛的本币（buyIn / prize 都以此币种存储原始金额）。
 * - totalPlayers: 比赛总人数。
 * - tablePlayers: 每桌人数。
 * - buyIn / prize: 买入金额、最终奖金（按 currency 存原始数值）。
 * - finalRank: 最后名次（1 = 冠军）。
 * - date: 用户填的比赛时间（ISO 字符串）。可空，空时展示 createdAt。
 * - createdAt: 记录创建时间（ISO 字符串）。
 * - note: 备注（可选；UI 暂不展示但保留字段）。
 */
export type Currency = 'USD' | 'CNY' | 'JPY';

export interface CurrencyMeta {
  id: Currency;
  symbol: string;
  label: string;
}

// JPY 与 CNY 在 ISO 都是 ¥，为避免列表/卡片金额无法肉眼区分，JPY 显式用 `JP¥`。
export const CURRENCIES: CurrencyMeta[] = [
  { id: 'USD', symbol: '$', label: '美元 USD' },
  { id: 'CNY', symbol: '¥', label: '人民币 CNY' },
  { id: 'JPY', symbol: 'JP¥', label: '日元 JPY' },
];

export const DEFAULT_CURRENCY: Currency = 'USD';

/**
 * 各币种兑 USD 的固定汇率（amount × rate = USD 金额）。
 * 初版用固定值；后续若要支持动态汇率，把这里改成 store 读值即可，不动数据结构。
 */
export const USD_RATES: Record<Currency, number> = {
  USD: 1,
  CNY: 1 / 7.2,
  JPY: 1 / 150,
};

export function currencyMeta(c: Currency): CurrencyMeta {
  return CURRENCIES.find((x) => x.id === c) ?? CURRENCIES[0];
}

/** 把任意币种金额折算为 USD。 */
export function toUSD(amount: number, currency: Currency): number {
  const rate = USD_RATES[currency] ?? 1;
  return amount * rate;
}

export interface Tournament {
  id: string;
  name: string;
  iconId: string;
  currency: Currency;
  totalPlayers: number;
  tablePlayers: number;
  buyIn: number;
  finalRank: number;
  prize: number;
  /**
   * 是否为赏金赛（PKO / KO）。
   * 仅当为 true 时 `bounty` 才参与盈亏/ROI/总奖金的累加；false 时 `bounty` 字段被忽略（不显示也不计算）。
   */
  hasBounty?: boolean;
  /** 本场赚到的赏金金额，按 currency 存原始值。 */
  bounty?: number;
  date?: string;
  createdAt: string;
  note?: string;
}

/**
 * 取一场比赛参与计算的「有效赏金」：未勾选赏金赛 / 无金额 → 0。
 */
export function effectiveBounty(t: Tournament): number {
  if (!t.hasBounty) return 0;
  const b = t.bounty ?? 0;
  return Number.isFinite(b) && b > 0 ? b : 0;
}

/**
 * 取一场比赛的「总收益」（本币原始数值）= prize + 有效赏金。
 * 行盈亏 / ITM 判定都基于这个值。
 */
export function totalEarning(t: Tournament): number {
  return t.prize + effectiveBounty(t);
}

export interface TournamentSummary {
  /** 比赛次数。 */
  count: number;
  /** 总买入金额（已折算为 USD）。 */
  totalBuyIn: number;
  /** 总奖金（已折算为 USD）。 */
  totalPrize: number;
  /** 净盈亏（USD） = totalPrize - totalBuyIn。 */
  netProfit: number;
  /**
   * ROI = (totalPrize - totalBuyIn) / totalBuyIn。
   * 当 totalBuyIn = 0 时返回 0，避免 NaN/Infinity。
   */
  roi: number;
  /** 进入钱圈的场次（prize > 0 视为 ITM）。 */
  itmCount: number;
  /**
   * ITM 概率 = itmCount / count。
   * 当 count = 0 时返回 0，避免 NaN。
   */
  itmRate: number;
}

export function summarize(list: Tournament[]): TournamentSummary {
  let totalBuyIn = 0;
  let totalPrize = 0;
  let itmCount = 0;
  for (const t of list) {
    totalBuyIn += toUSD(t.buyIn, t.currency);
    const earning = totalEarning(t);
    totalPrize += toUSD(earning, t.currency);
    if (earning > 0) itmCount += 1;
  }
  const netProfit = totalPrize - totalBuyIn;
  const roi = totalBuyIn > 0 ? netProfit / totalBuyIn : 0;
  const itmRate = list.length > 0 ? itmCount / list.length : 0;
  return {
    count: list.length,
    totalBuyIn,
    totalPrize,
    netProfit,
    roi,
    itmCount,
    itmRate,
  };
}

/** 取展示时使用的「日期」：date 优先，否则用 createdAt。 */
export function displayDate(t: Tournament): string {
  return t.date && t.date.trim() ? t.date : t.createdAt;
}

/** 把展示日期转为 timestamp，方便比较 / 排序。无效时回退到 0。 */
export function displayTimestamp(t: Tournament): number {
  const raw = displayDate(t);
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

/** 千分位金额展示（纯数字，不含符号）。 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const fixed = Math.round(n).toLocaleString('en-US');
  return fixed;
}

/** 带币种符号的金额展示，例如 `$1,234` / `¥8,888`。 */
export function formatCurrency(n: number, currency: Currency): string {
  return `${currencyMeta(currency).symbol}${formatMoney(n)}`;
}

/** 带 USD 符号的金额展示，固定 `$1,234` 形式。 */
export function formatUSD(n: number): string {
  return `$${formatMoney(n)}`;
}

/** 百分比展示，保留 1 位小数。 */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return '0.0%';
  return `${(n * 100).toFixed(1)}%`;
}
