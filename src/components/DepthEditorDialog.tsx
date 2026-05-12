import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findDuplicateLabel,
  isLabelUnique,
  type DepthGrid,
  type SeatBucket,
} from '@/lib/depths';
import { rangeActions, useDraft } from '@/store/useRangeStore';
import styles from '@/styles/dialog.module.css';

interface Props {
  onClose: () => void;
}

type Working = Array<{
  /** 稳定的本地 uid，避免拖拽时 key 跳变 */
  uid: string;
  /** 缓存中的当前 label */
  label: string;
  /** 该项各英雄座位对应的 SeatBucket（含 overall 与 vs[opp]） */
  seats: Record<string, SeatBucket>;
  /** 是否为新增（新增项无任何座位涂色） */
  isNew: boolean;
}>;

let uidSeq = 0;
function uid(): string {
  return `u${(++uidSeq).toString(36)}`;
}

function workingFromDepths(depths: DepthGrid[]): Working {
  return depths.map((d) => ({
    uid: uid(),
    label: d.label,
    seats: { ...d.seats },
    isNew: false,
  }));
}

/** 数一个深度下所有 (英雄座位 × overall + 各 vs) 的非 fold 格子数总和。 */
function totalMarks(seats: Record<string, SeatBucket>): number {
  let n = 0;
  for (const bucket of Object.values(seats)) {
    n += Object.keys(bucket.overall).length;
    for (const cells of Object.values(bucket.vs)) {
      n += Object.keys(cells).length;
    }
  }
  return n;
}

export function DepthEditorDialog({ onClose }: Props) {
  const draft = useDraft();
  const initial = useMemo<Working>(() => workingFromDepths(draft.depths), [draft.depths]);
  const [items, setItems] = useState<Working>(initial);
  const [newLabel, setNewLabel] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const renameAt = (i: number, label: string) => {
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, label } : it)));
  };

  const removeAt = (i: number) => {
    const it = items[i];
    const word = it.isNew ? '新添加的深度' : `深度「${it.label}」`;
    const ok = window.confirm(`确认删除${word}？该深度的所有标记会丢失（点击应用后生效）。`);
    if (!ok) return;
    setItems((cur) => cur.filter((_, idx) => idx !== i));
  };

  const addNew = () => {
    const label = newLabel.trim();
    if (!label) {
      setErrMsg('深度标签不能为空');
      return;
    }
    if (!isLabelUnique(items.map((x) => x.label), label)) {
      setErrMsg(`标签 "${label}" 已存在`);
      return;
    }
    setItems((cur) => [...cur, { uid: uid(), label, seats: {}, isNew: true }]);
    setNewLabel('');
    setErrMsg(null);
  };

  const onDragStart = (e: React.DragEvent, i: number) => {
    dragIndexRef.current = i;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(i);
  };
  const onDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    setDragOverIndex(null);
    dragIndexRef.current = null;
    if (from == null || from === i) return;
    setItems((cur) => {
      const next = cur.slice();
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
  };
  const onDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const onApply = () => {
    if (items.length === 0) {
      setErrMsg('至少保留一个深度');
      return;
    }
    const labels = items.map((it) => it.label.trim());
    if (labels.some((l) => !l)) {
      setErrMsg('深度标签不能为空');
      return;
    }
    const dup = findDuplicateLabel(labels);
    if (dup) {
      setErrMsg(`深度标签重复："${labels[dup.a]}"`);
      return;
    }
    const newDepths: DepthGrid[] = items.map((it, idx) => ({
      label: labels[idx],
      seats: it.seats,
    }));
    rangeActions.applyDepthEdits(newDepths, saveAsDefault);
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="编辑当前范围的深度"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>
          编辑当前范围的深度
          <button className="ghost" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className={styles.hint}>
          支持拖拽排序、内联改名、删除。仅修改<strong>当前范围</strong>的深度集合，不影响其他范围。
        </div>

        <ul className={styles.depthEditList}>
          {items.map((it, i) => (
            <li
              key={it.uid}
              className={`${styles.depthEditItem} ${dragOverIndex === i ? styles.dragOver : ''}`}
              draggable
              onDragStart={(e) => onDragStart(e, i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => onDrop(e, i)}
              onDragEnd={onDragEnd}
            >
              <span className={styles.handle} title="拖动排序">⋮⋮</span>
              <input
                type="text"
                value={it.label}
                onChange={(e) => renameAt(i, e.target.value)}
                spellCheck={false}
              />
              <span className={styles.cellsBadge}>
                {totalMarks(it.seats)} 标记
              </span>
              <button
                type="button"
                className="ghost"
                aria-label="删除"
                onClick={() => removeAt(i)}
              >
                ×
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className={styles.empty}>请至少添加一个深度</li>
          )}
        </ul>

        <div className={styles.addRow}>
          <input
            type="text"
            placeholder="新深度标签（如 50bb）"
            value={newLabel}
            onChange={(e) => {
              setNewLabel(e.target.value);
              setErrMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addNew();
              }
            }}
            spellCheck={false}
          />
          <button type="button" onClick={addNew}>
            + 添加深度
          </button>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
          />
          <span>同时保存为新建范围的默认模板</span>
        </label>

        {errMsg && <div className={styles.error}>{errMsg}</div>}

        <div className={styles.footer}>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={onApply}>
            应用
          </button>
        </div>
      </div>
    </div>
  );
}
