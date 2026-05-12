import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SEATS, MAX_SEATS, MIN_SEATS } from '@/store/storage';
import styles from '@/styles/dialog.module.css';

interface Props {
  defaultName?: string;
  defaultSeats?: number;
  title?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: (name: string, seats: number) => void;
}

const SEAT_OPTIONS = Array.from(
  { length: MAX_SEATS - MIN_SEATS + 1 },
  (_, i) => MIN_SEATS + i,
);

export function NewRangeDialog({
  defaultName = 'Untitled',
  defaultSeats = DEFAULT_SEATS,
  title = '新建方案',
  confirmText = '创建',
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [seats, setSeats] = useState(defaultSeats);
  const [errMsg, setErrMsg] = useState<string | null>(null);
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

  const submit = () => {
    const finalName = name.trim();
    if (!finalName) {
      setErrMsg('方案名称不能为空');
      return;
    }
    onConfirm(finalName, seats);
  };

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>
          {title}
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>方案名称</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            spellCheck={false}
            placeholder="如 BTN RFI"
          />
        </label>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>人数（座位数）</span>
          <div className={styles.seatGrid} role="radiogroup" aria-label="人数">
            {SEAT_OPTIONS.map((n) => {
              const active = n === seats;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`${styles.seatBtn} ${active ? styles.seatBtnActive : ''}`}
                  onClick={() => setSeats(n)}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <span className={styles.fieldHint}>{seats} 人桌</span>
        </div>

        {errMsg && <div className={styles.error}>{errMsg}</div>}

        <div className={styles.footer}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
