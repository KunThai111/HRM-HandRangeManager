import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ProfitChart } from '@/components/home/ProfitChart';
import { ProfitPlanCard } from '@/components/home/ProfitPlanCard';
import { StatCard } from '@/components/home/StatCard';
import { TournamentList } from '@/components/home/TournamentList';
import { formatPercent, formatUSD, summarize } from '@/lib/tournaments';
import { usePreferences } from '@/store/usePreferencesStore';
import { useTournaments } from '@/store/useTournamentStore';
import styles from '@/styles/home.module.css';

export function HomePage() {
  const tournaments = useTournaments();
  const prefs = usePreferences();
  const summary = useMemo(() => summarize(tournaments), [tournaments]);

  const roiTone =
    summary.roi > 0 ? 'positive' : summary.roi < 0 ? 'negative' : 'neutral';
  const profitTone =
    summary.netProfit > 0
      ? 'positive'
      : summary.netProfit < 0
        ? 'negative'
        : 'neutral';

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {prefs.showTournamentStats && (
          <div className={styles.statGrid}>
            <StatCard
              label="总奖金"
              value={formatUSD(summary.totalPrize)}
              sub={
                summary.count > 0
                  ? `平均 ${formatUSD(summary.totalPrize / summary.count)} / 场`
                  : '暂无记录'
              }
              tone={profitTone}
              icon={
                <span className={styles.statIconMoney}>
                  <span className={styles.statIconMoneyBack}>💵</span>
                  <span className={styles.statIconMoneyMid}>💵</span>
                  <span className={styles.statIconMoneyFront}>💵</span>
                </span>
              }
            />
            <StatCard
              label="总比赛"
              value={String(summary.count)}
              sub={`总买入 ${formatUSD(summary.totalBuyIn)}`}
              icon="🏆"
            />
            <StatCard
              label="ROI"
              value={formatPercent(summary.roi)}
              sub={`净盈亏 ${formatUSD(summary.netProfit)}`}
              tone={roiTone}
              icon={summary.roi >= 0 ? '📈' : '📉'}
            />
            <StatCard
              label="ITM"
              value={formatPercent(summary.itmRate)}
              sub={summary.count > 0 ? `进入钱圈 ${summary.itmCount} / ${summary.count}` : '暂无记录'}
              icon="🎯"
            />
          </div>
        )}

        {prefs.showProfitChart && <ProfitChart tournaments={tournaments} />}

        <ProfitPlanCard tournaments={tournaments} />

        <div className={styles.quickRow}>
          <Link to="/range" className={styles.quickCard}>
            <span className={styles.quickIcon} aria-hidden>
              ♠
            </span>
            <span className={styles.quickBody}>
              <span className={styles.quickTitle}>手牌编辑器</span>
              <span className={styles.quickDesc}>
                13×13 起手牌表 · 多座位 / 多深度 / 自定义动作
              </span>
            </span>
            <span className={styles.quickArrow} aria-hidden>
              →
            </span>
          </Link>
        </div>

        <TournamentList limit={3} showCreate showViewAll />
      </div>
    </div>
  );
}
