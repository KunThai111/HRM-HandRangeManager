import styles from '@/styles/home.module.css';

interface Props {
  label: string;
  value: string;
  sub?: string;
  /** 影响数值颜色：positive=绿、negative=红，其他默认色。 */
  tone?: 'positive' | 'negative' | 'neutral';
}

export function StatCard({ label, value, sub, tone = 'neutral' }: Props) {
  const valueClass =
    tone === 'positive'
      ? `${styles.statValue} ${styles.statValuePositive}`
      : tone === 'negative'
        ? `${styles.statValue} ${styles.statValueNegative}`
        : styles.statValue;

  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={valueClass}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}
