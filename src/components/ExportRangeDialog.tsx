import { useEffect, useMemo, useState } from 'react';
import { rangeActions, useRangesSorted } from '@/store/useRangeStore';
import { clampSeats } from '@/store/storage';
import styles from '@/styles/dialog.module.css';
import settings from '@/styles/settingsPage.module.css';

interface Props {
  onClose: () => void;
}

/** 把任意字符串转成相对安全的文件名片段：去除控制字符 / 路径分隔符，限制长度。 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Untitled').slice(0, 80);
}

function triggerDownload(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportRangeDialog({ onClose }: Props) {
  const ranges = useRangesSorted();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const hasRanges = ranges.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onExport = (id: string) => {
    const out = rangeActions.exportRangeToJSON(id);
    if (!out) return;
    triggerDownload(out.json, `HRM-${sanitizeFilename(out.name)}.json`);
    setDoneIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const onExportAll = () => {
    for (const r of ranges) onExport(r.id);
  };

  const title = useMemo(() => `导出范围方案（${ranges.length}）`, [ranges.length]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="导出范围方案"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>
          {title}
          <button className="ghost" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.hint}>
          每个方案会下载为 <code>HRM-方案名称.json</code>，保存到浏览器默认下载目录。
        </div>

        {hasRanges ? (
          <ul className={settings.exportList}>
            {ranges.map((r) => {
              const done = doneIds.has(r.id);
              return (
                <li key={r.id} className={settings.exportItem}>
                  <div className={settings.exportItemText}>
                    <div className={settings.exportItemName}>{r.name}</div>
                    <div className={settings.exportItemMeta}>
                      {clampSeats(r.seats)} 人桌 · {r.depths.length} 个深度
                    </div>
                  </div>
                  <button type="button" onClick={() => onExport(r.id)}>
                    {done ? '再次导出' : '导出'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.empty}>暂无可导出的方案</div>
        )}

        <div className={styles.footer}>
          {hasRanges && ranges.length > 1 && (
            <button type="button" onClick={onExportAll}>
              全部导出
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
