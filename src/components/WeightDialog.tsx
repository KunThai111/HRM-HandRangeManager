import { useEffect, useRef, useState } from 'react';
import { clampWeight, type ResolvedAction } from '@/lib/colors';
import styles from '@/styles/dialog.module.css';

interface Props {
  /** 当前要涂的动作（已 resolve，用于预览颜色 / 名称）。 */
  action: ResolvedAction;
  /** 当前 hand 文案（如 `AKs`），仅用于标题显示。 */
  hand: string;
  /** 弹窗打开时的初始权重（1-100）。 */
  initial: number;
  onCancel: () => void;
  onConfirm: (weight: number) => void;
}

export function WeightDialog({ action, hand, initial, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState<number>(clampWeight(initial));
  const [text, setText] = useState<string>(String(clampWeight(initial)));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const apply = (raw: number) => {
    const next = clampWeight(raw);
    setValue(next);
    setText(String(next));
  };

  const submit = () => {
    onConfirm(clampWeight(value));
  };

  // 预览块：自左向右按 value% 填充动作色
  const previewBg = `linear-gradient(to right, ${action.color} 0% ${value}%, var(--bg-0) ${value}% 100%)`;

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="设置操作占比"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 360 }}
      >
        <div className={styles.title}>
          设置 {hand} 的操作占比
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.hint}>
          按住 Cmd / Ctrl 点击格子可设置该格的动作占比（1–100%）。
          颜色将按占比从底部填充，剩余部分保持 Fold 背景。
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>
            动作：
            <span className="action-dot" style={{ background: action.color, marginLeft: 6 }} />
            <span style={{ marginLeft: 4 }}>{action.label}</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={value}
              onChange={(e) => apply(Number(e.target.value))}
              className={styles.slider}
              style={{
                flex: 1,
                background: `linear-gradient(to right, var(--accent-selected) 0% ${value}%, var(--bg-3) ${value}% 100%)`,
              }}
              aria-label="操作占比滑块"
            />
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={text}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
                setText(raw);
                if (raw === '') return;
                const n = parseInt(raw, 10);
                if (Number.isFinite(n)) setValue(clampWeight(n));
              }}
              onBlur={() => {
                const n = parseInt(text, 10);
                if (!Number.isFinite(n)) apply(value);
                else apply(n);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              style={{ width: 56, textAlign: 'right' }}
              aria-label="操作占比数值"
            />
            <span style={{ color: 'var(--text-2)' }}>%</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>预览</span>
          <div
            style={{
              height: 56,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: previewBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              color: 'var(--text-0)',
              fontSize: 13,
            }}
          >
            {hand} · {value}%
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
