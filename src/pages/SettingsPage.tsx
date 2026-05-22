import { preferenceActions, usePreferences, type Preferences } from '@/store/usePreferencesStore';
import styles from '@/styles/settingsPage.module.css';

export function SettingsPage() {
  const prefs = usePreferences();

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <h1 className={styles.title}>设置</h1>
          <p className={styles.subtitle}>个人偏好仅保存在本机，不参与云同步</p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>首页显示</h2>
          <ul className={styles.list}>
            <ToggleRow
              label="显示比赛统计"
              hint="首页顶部的「总奖金 / 总比赛 / ROI / ITM」四张卡片"
              checked={prefs.showTournamentStats}
              prefKey="showTournamentStats"
            />
            <ToggleRow
              label="显示盈亏曲线"
              hint="首页中部的「比赛盈亏」累计折线图"
              checked={prefs.showProfitChart}
              prefKey="showProfitChart"
            />
          </ul>
        </section>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  prefKey: keyof Preferences;
}

function ToggleRow({ label, hint, checked, prefKey }: ToggleRowProps) {
  return (
    <li className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {hint && <div className={styles.rowHint}>{hint}</div>}
      </div>
      <label className={styles.switch} aria-label={label}>
        <input
          type="checkbox"
          className={styles.switchInput}
          checked={checked}
          onChange={(e) => preferenceActions.set(prefKey, e.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden>
          <span className={styles.switchThumb} />
        </span>
      </label>
    </li>
  );
}
