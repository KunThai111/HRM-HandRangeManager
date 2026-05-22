import { useRef, useState } from 'react';
import { ExportRangeDialog } from '@/components/ExportRangeDialog';
import { rangeActions } from '@/store/useRangeStore';
import { preferenceActions, usePreferences, type Preferences } from '@/store/usePreferencesStore';
import styles from '@/styles/settingsPage.module.css';

type FlashTone = 'ok' | 'error';
interface Flash {
  tone: FlashTone;
  text: string;
}

export function SettingsPage() {
  const prefs = usePreferences();
  const [exporting, setExporting] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showFlash = (tone: FlashTone, text: string) => {
    setFlash({ tone, text });
    window.setTimeout(() => {
      setFlash((cur) => (cur && cur.text === text ? null : cur));
    }, 3500);
  };

  const onPickFile = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const successes: string[] = [];
    const failures: { file: string; reason: string }[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const res = rangeActions.importRangeFromJSON(text);
        if (res.ok && res.name) {
          successes.push(res.name);
        } else {
          failures.push({ file: file.name, reason: res.error ?? '未知错误' });
        }
      } catch (err) {
        failures.push({
          file: file.name,
          reason: err instanceof Error ? err.message : '读取文件失败',
        });
      }
    }

    if (successes.length > 0 && failures.length === 0) {
      const head = successes.slice(0, 3).join('、');
      const tail = successes.length > 3 ? ` 等 ${successes.length} 个方案` : '';
      showFlash('ok', `已导入：${head}${tail}`);
    } else if (failures.length > 0 && successes.length === 0) {
      showFlash('error', `导入失败：${failures[0].file} — ${failures[0].reason}`);
    } else {
      showFlash(
        'ok',
        `导入完成：成功 ${successes.length} 个，失败 ${failures.length} 个`,
      );
    }
  };

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

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>方案数据</h2>
          <ul className={styles.list}>
            <li className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowLabel}>导出范围方案</div>
                <div className={styles.rowHint}>
                  在弹出列表中选择方案，下载为 <code>HRM-方案名称.json</code> 到浏览器默认下载目录。
                </div>
              </div>
              <button type="button" onClick={() => setExporting(true)}>
                导出方案
              </button>
            </li>
            <li className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowLabel}>导入范围方案</div>
                <div className={styles.rowHint}>
                  选择一个或多个 <code>HRM-*.json</code> 文件，若与现有方案重名会自动追加「（导入）」后缀。
                </div>
              </div>
              <button type="button" onClick={onPickFile}>
                导入方案
              </button>
            </li>
          </ul>
          {flash && (
            <div
              className={`${styles.flash} ${flash.tone === 'error' ? styles.flashError : styles.flashOk}`}
              role="status"
            >
              {flash.text}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            multiple
            onChange={onFileChange}
            hidden
          />
        </section>
      </div>

      {exporting && <ExportRangeDialog onClose={() => setExporting(false)} />}
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
