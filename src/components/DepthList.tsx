import { useState } from 'react';
import { countNonFold } from '@/lib/depths';
import { rangeActions, useDraft } from '@/store/useRangeStore';
import { DepthEditorDialog } from '@/components/DepthEditorDialog';
import styles from '@/styles/sidebar.module.css';

export function DepthList() {
  const { rangeId, depths, currentDepthLabel } = useDraft();
  const [editing, setEditing] = useState(false);

  const onSwitch = (label: string) => {
    if (label === currentDepthLabel) return;
    rangeActions.switchDepth(label);
  };

  if (!rangeId) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>筹码范围</div>
        <div className={styles.empty}>先选择或新建一个范围</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>筹码范围</span>
      </div>
      <ul className={styles.depthList}>
        {depths.map((d) => {
          const active = d.label === currentDepthLabel;
          const hit = countNonFold(d.cells);
          return (
            <li
              key={d.label}
              className={`${styles.depthItem} ${active ? styles.active : ''}`}
              onClick={() => onSwitch(d.label)}
            >
              <span className={styles.depthLabel}>{d.label}</span>
              <span className={styles.depthBadge}>
                {hit}/169
              </span>
            </li>
          );
        })}
      </ul>
      <div className={styles.btnRow}>
        <button type="button" onClick={() => setEditing(true)}>
          ⚙ 编辑深度
        </button>
      </div>
      {editing && <DepthEditorDialog onClose={() => setEditing(false)} />}
    </div>
  );
}
