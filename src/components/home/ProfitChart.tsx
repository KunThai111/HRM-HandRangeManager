import { useMemo, useState } from 'react';
import {
  displayDate,
  displayTimestamp,
  formatUSD,
  toUSD,
  totalEarning,
  type Tournament,
} from '@/lib/tournaments';
import styles from '@/styles/home.module.css';

interface Props {
  tournaments: Tournament[];
}

interface Point {
  /** 该场比赛 id，用于 hover key。 */
  id: string;
  /** 横坐标：累计场次（1-based，第几场）。 */
  x: number;
  /**
   * 纵坐标（USD）：截止「本场结束」时的「总盈利 − 总买入」。
   * 等价于 Σ_{k≤i}(prize_k + 赏金_k) − Σ_{k≤i}(买入_k)，
   * 也等价于逐场 (prize+赏金−买入) 的前缀和。
   */
  y: number;
  /** 截止本场的「累计总买入」(USD)，tooltip 用。 */
  cumBuyIn: number;
  /** 截止本场的「累计总盈利」(USD) = Σ(prize + 有效赏金)，tooltip 用。 */
  cumPrize: number;
  name: string;
  /** 已格式化为「YYYY年MM月DD日」的展示日期，tooltip 用。 */
  date: string;
}

/** 把 ISO / 可解析日期串格式化为「YYYY年MM月DD日」；无效时原样返回。 */
function formatChineseDate(raw: string): string {
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return raw;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}年${m}月${day}日`;
}

/** SVG 内部坐标系（与显示像素无关，靠 viewBox 自适应）。 */
const VB_W = 800;
const VB_H = 320;
const PAD_L = 16;
const PAD_R = 56;
const PAD_T = 16;
const PAD_B = 28;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

/**
 * Y 轴上下界 + 刻度：
 * - 保证 0 在画布内且落在刻度上；
 * - 选用 1/2/2.5/5 × 10^k 的 nice step，使刻度数 ≥ target；
 * - 以 step 对 lo/hi 取整，顺带提供留白。
 */
function niceYRange(
  min: number,
  max: number,
  target = 7,
): { lo: number; hi: number; ticks: number[] } {
  let lo0 = Math.min(0, min);
  let hi0 = Math.max(0, max);
  if (!Number.isFinite(lo0) || !Number.isFinite(hi0)) {
    return { lo: 0, hi: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
  }
  if (lo0 === hi0) {
    const pad = Math.abs(lo0) > 0 ? Math.abs(lo0) * 0.2 : 1;
    lo0 -= pad;
    hi0 += pad;
  }
  const span = hi0 - lo0;
  const rawStep = span / (target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm >= 5) step = 5 * mag;
  else if (norm >= 2.5) step = 2.5 * mag;
  else if (norm >= 2) step = 2 * mag;
  else step = 1 * mag;

  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;
  const count = Math.round((hi - lo) / step) + 1;
  const ticks: number[] = [];
  for (let i = 0; i < count; i += 1) {
    ticks.push(lo + i * step);
  }
  return { lo, hi, ticks };
}

function formatShortUSD(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** 在 [1, n] 范围内生成最多 maxTicks 个整数刻度（含 1 和 n，去重）。 */
function buildXTicks(n: number, maxTicks = 5): number[] {
  if (n <= 0) return [];
  if (n <= maxTicks) {
    return Array.from({ length: n }, (_, i) => i + 1);
  }
  const step = (n - 1) / (maxTicks - 1);
  const out: number[] = [];
  for (let i = 0; i < maxTicks; i += 1) {
    out.push(Math.round(1 + step * i));
  }
  return Array.from(new Set(out));
}

export function ProfitChart({ tournaments }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const points = useMemo<Point[]>(() => {
    // 按比赛日期升序累计；相同日期用 createdAt 兜底，保证稳定顺序。
    const sorted = [...tournaments].sort((a, b) => {
      const ta = displayTimestamp(a);
      const tb = displayTimestamp(b);
      if (ta !== tb) return ta - tb;
      return a.createdAt.localeCompare(b.createdAt);
    });

    // Y = 截止本场的「总盈利 − 总买入」(USD)。
    // tooltip 还要分别展示「总买入」「总盈利」，所以这里同步累加两侧。
    let cumBuyIn = 0;
    let cumPrize = 0;
    return sorted.map<Point>((t, i) => {
      cumBuyIn += toUSD(t.buyIn, t.currency);
      cumPrize += toUSD(totalEarning(t), t.currency);
      return {
        id: t.id,
        x: i + 1,
        y: cumPrize - cumBuyIn,
        cumBuyIn,
        cumPrize,
        name: t.name,
        date: formatChineseDate(displayDate(t)),
      };
    });
  }, [tournaments]);

  if (points.length === 0) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>盈亏曲线</span>
        </div>
        <div className={styles.chartEmpty}>暂无比赛记录</div>
      </div>
    );
  }

  const ys = points.map((p) => p.y);
  const xLo = 0;
  const xHi = points.length;
  const {
    lo: yLo,
    hi: yHi,
    ticks: yTicks,
  } = niceYRange(Math.min(...ys), Math.max(...ys), 7);

  const xScale = (x: number) =>
    PAD_L + ((x - xLo) / (xHi - xLo || 1)) * PLOT_W;
  const yScale = (y: number) =>
    PAD_T + (1 - (y - yLo) / (yHi - yLo || 1)) * PLOT_H;

  const yZero = yScale(0);

  // 折线从 (0, 0) 起点出发，依次连到每场累计点。
  const linePath = [
    `M ${xScale(0)} ${yScale(0)}`,
    ...points.map((p) => `L ${xScale(p.x)} ${yScale(p.y)}`),
  ].join(' ');

  const xTicks = buildXTicks(points.length);

  const hovered = hoverId ? points.find((p) => p.id === hoverId) ?? null : null;

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>盈亏曲线</span>
      </div>

      <div className={styles.chartBody}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="盈亏曲线"
        >
          <defs>
            <clipPath id="profit-up-clip">
              <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={Math.max(0, yZero - PAD_T)} />
            </clipPath>
            <clipPath id="profit-down-clip">
              <rect
                x={PAD_L}
                y={yZero}
                width={PLOT_W}
                height={Math.max(0, PAD_T + PLOT_H - yZero)}
              />
            </clipPath>
          </defs>

          {yTicks.map((t) => (
            <g key={`gy-${t}`}>
              {t === 0 && (
                <line
                  x1={PAD_L}
                  x2={PAD_L + PLOT_W}
                  y1={yScale(t)}
                  y2={yScale(t)}
                  className={styles.chartZero}
                />
              )}
              <text
                x={PAD_L + PLOT_W + 8}
                y={yScale(t)}
                className={styles.chartAxisText}
                textAnchor="start"
                dominantBaseline="middle"
              >
                {formatShortUSD(t)}
              </text>
            </g>
          ))}

          <line
            x1={PAD_L + PLOT_W}
            x2={PAD_L + PLOT_W}
            y1={PAD_T}
            y2={PAD_T + PLOT_H}
            className={styles.chartZero}
          />

          <path
            d={linePath}
            fill="none"
            stroke="var(--ok)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            clipPath="url(#profit-up-clip)"
          />
          <path
            d={linePath}
            fill="none"
            stroke="var(--danger)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            clipPath="url(#profit-down-clip)"
          />

          {points.map((p) => {
            const cx = xScale(p.x);
            const cy = yScale(p.y);
            return (
              <circle
                key={p.id}
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverId(p.id)}
                onMouseLeave={() => setHoverId((cur) => (cur === p.id ? null : cur))}
              />
            );
          })}

          {xTicks.map((t) => (
            <text
              key={`tx-${t}`}
              x={xScale(t)}
              y={PAD_T + PLOT_H + 16}
              className={styles.chartAxisText}
              textAnchor="middle"
            >
              {t}
            </text>
          ))}
        </svg>

        {hovered && (
          <div
            className={styles.chartTooltip}
            style={{
              left: `${((xScale(hovered.x) - PAD_L) / PLOT_W) * 100}%`,
              top: `${(yScale(hovered.y) / VB_H) * 100}%`,
            }}
          >
            <div className={styles.chartTooltipTitle}>{hovered.date}</div>
            <div className={styles.chartTooltipRow}>
              <span>总买入</span>
              <span>{formatUSD(hovered.cumBuyIn)}</span>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>总盈利</span>
              <span>{formatUSD(hovered.cumPrize)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
