import { useEffect, useRef } from 'react';
import styles from '@/styles/dialog.module.css';

interface Props {
  title?: string;
  /** 可传字符串或 ReactNode（用于高亮方案名等）。 */
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（如删除）：确认按钮使用 danger 配色，默认焦点在取消按钮。 */
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title = '请确认',
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onCancel,
  onConfirm,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const target = danger ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [danger]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-label={title}
        style={{ maxWidth: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>
          {title}
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.hint} style={{ color: 'var(--text-1)', fontSize: 13 }}>
          {message}
        </div>

        <div className={styles.footer}>
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
