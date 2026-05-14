import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cellSegments, resolveActionOrFold } from '@/lib/colors';
import {
  getCurrentCells,
  rangeActions,
  useCustomActions,
  useDraft,
  useNotes,
} from '@/store/useRangeStore';
import styles from '@/styles/rangeDetail.module.css';

interface Props {
  /** 当前被放大查看的 hand（如 `AKs`），由父组件保证非空时才挂载本组件。 */
  hand: string;
  onClose: () => void;
}

interface BreakdownItem {
  key: string;
  label: string;
  color: string;
  textColor: string;
  /** 该段的百分比（0–100）。多段之和应为 100。 */
  weight: number;
  /** 是否对应「Fold（清空）」的兜底段。 */
  isFold: boolean;
}

/**
 * 把当前激活子表里某格的字符串值展开成 UI 友好的「动作占比」分段：
 * - 空 / fold → 单段 100% Fold
 * - 单段或多段 → 按 segments 顺序展开；若总和 < 100，最后追加一段 Fold
 */
function useBreakdown(hand: string): BreakdownItem[] {
  const draft = useDraft();
  const customActions = useCustomActions();
  const cells = getCurrentCells(draft);
  return useMemo<BreakdownItem[]>(() => {
    const fold = resolveActionOrFold('fold', customActions);
    const segs = cellSegments(cells[hand]);
    if (segs.length === 0) {
      return [
        {
          key: 'fold',
          label: fold.label,
          color: fold.color,
          textColor: fold.textColor,
          weight: 100,
          isFold: true,
        },
      ];
    }
    const items: BreakdownItem[] = [];
    let sum = 0;
    segs.forEach((s, i) => {
      const action = resolveActionOrFold(s.id, customActions);
      items.push({
        key: `${s.id}-${i}`,
        label: action.label,
        color: action.color,
        textColor: action.textColor,
        weight: s.weight,
        isFold: false,
      });
      sum += s.weight;
    });
    if (sum < 100) {
      items.push({
        key: 'fold-rest',
        label: fold.label,
        color: fold.color,
        textColor: fold.textColor,
        weight: 100 - sum,
        isFold: true,
      });
    }
    return items;
  }, [cells, customActions, hand]);
}

export function RangeDetail({ hand, onClose }: Props) {
  const draft = useDraft();
  const notes = useNotes();
  const breakdown = useBreakdown(hand);
  const persisted = notes[hand] ?? '';

  // 备注本地缓冲：每次按键只更新本地 state，避免在打字时反复触发 draft 比对 / dirty。
  // 失焦 / Cmd+Enter / 切 hand / 组件卸载时再 commit 到 store。
  const [text, setText] = useState(persisted);

  // 外部 notes 变了（切换 hand / 切换 range / 撤销后 dirty 回滚等）→ 重置输入框。
  useEffect(() => {
    setText(persisted);
  }, [persisted, hand]);

  // 通过 ref 暴露最新文本，给「hand 切换 / 卸载」时的 cleanup 用，
  // 避免用户未失焦就点别的格子导致输入被丢弃。
  const textRef = useRef(text);
  textRef.current = text;

  // 关键：依赖只放 hand。每次 hand 变化时，cleanup 用旧的 hand 闭包 +
  // ref 里此刻的最新 text，把未保存内容落到旧 hand 上；新 effect 才挂载下一段闭包。
  useEffect(() => {
    const currentHand = hand;
    return () => {
      const latest = textRef.current;
      rangeActions.setNote(currentHand, latest);
    };
  }, [hand]);

  const commit = useCallback(() => {
    if (text !== persisted) {
      rangeActions.setNote(hand, text);
    }
  }, [text, persisted, hand]);

  return (
    <aside className={styles.panel} data-range-detail aria-label={`${hand} 详细信息`}>
      <header className={styles.head}>
        <span className={styles.handLabel}>{hand}</span>
        <span className={styles.handTitle}>详细</span>
        <button
          type="button"
          className={styles.closeBtn}
          aria-label="关闭详情"
          title="关闭（Esc）"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>动作占比</div>
        <div className={styles.bar} role="img" aria-label="动作占比条">
          {breakdown.map((b, i) => (
            <span
              key={`seg-${i}`}
              className={`${styles.barSeg} ${b.isFold ? styles.barSegFold : ''}`}
              style={{ width: `${b.weight}%`, background: b.color }}
            />
          ))}
        </div>
        <ul className={styles.actionList}>
          {breakdown.map((b, i) => (
            <li key={`row-${i}`} className={styles.actionRow}>
              <span
                className={`${styles.actionDot} ${b.isFold ? styles.actionDotFold : ''}`}
                style={{ background: b.color }}
                aria-hidden
              />
              <span className={styles.actionLabel}>{b.label}</span>
              <span className={styles.actionWeight}>{b.weight}%</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>备注</div>
        <textarea
          className={styles.notesArea}
          rows={5}
          value={text}
          placeholder={
            draft.rangeId
              ? `给 ${hand} 写点笔记（任何模式都可编辑，保存时随方案一起落盘）`
              : '先选择或新建一个范围'
          }
          disabled={!draft.rangeId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.currentTarget as HTMLTextAreaElement).blur();
            }
          }}
        />
        <div className={styles.notesHint}>
          {text !== persisted ? '失焦自动保存 · ⌘/Ctrl+Enter 立即保存' : '已保存到草稿（仍需点顶部「保存」落盘）'}
        </div>
      </section>
    </aside>
  );
}
