import { useEffect, useRef, useState } from 'react';
import {
  bestTextColorOn,
  CUSTOM_COLOR_PRESETS,
  type CustomAction,
} from '@/lib/colors';
import styles from '@/styles/dialog.module.css';

interface Props {
  /** 不传 = 新增；传入 = 编辑该 action。 */
  initial?: CustomAction | null;
  title?: string;
  confirmText?: string;
  /** 已存在的 label，用于校验同名重复（编辑时排除自身）。 */
  existingLabels?: string[];
  onCancel: () => void;
  onConfirm: (label: string, color: string) => void;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(input: string): string {
  const v = input.trim();
  if (!v) return '';
  return v.startsWith('#') ? v : `#${v}`;
}

export function CustomActionDialog({
  initial,
  title = initial ? '编辑动作按钮' : '新增动作按钮',
  confirmText = initial ? '保存' : '添加',
  existingLabels = [],
  onCancel,
  onConfirm,
}: Props) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [color, setColor] = useState(initial?.color ?? CUSTOM_COLOR_PRESETS[0]);
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
    const finalLabel = label.trim();
    if (!finalLabel) {
      setErrMsg('名称不能为空');
      return;
    }
    if (
      existingLabels.some(
        (l) => l.trim().toLowerCase() === finalLabel.toLowerCase(),
      )
    ) {
      setErrMsg('已存在同名按钮');
      return;
    }
    const finalColor = normalizeHex(color);
    if (!HEX_RE.test(finalColor)) {
      setErrMsg('颜色格式不合法（示例：#ff8800）');
      return;
    }
    onConfirm(finalLabel, finalColor);
  };

  const previewColor = HEX_RE.test(normalizeHex(color))
    ? normalizeHex(color)
    : '#cccccc';
  const previewText = bestTextColorOn(previewColor);

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
          <span className={styles.fieldLabel}>按钮名称</span>
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setErrMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            spellCheck={false}
            placeholder="如 3-Bet / Limp"
            maxLength={20}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>颜色</span>
          <div className="custom-color-presets" role="radiogroup" aria-label="颜色">
            {CUSTOM_COLOR_PRESETS.map((c) => {
              const active = normalizeHex(color).toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`custom-color-swatch ${active ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    setErrMsg(null);
                  }}
                  title={c}
                />
              );
            })}
          </div>
          <div className="custom-color-row">
            <input
              type="color"
              value={HEX_RE.test(normalizeHex(color)) ? normalizeHex(color) : '#cccccc'}
              onChange={(e) => {
                setColor(e.target.value);
                setErrMsg(null);
              }}
              aria-label="自定义颜色"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setErrMsg(null);
              }}
              spellCheck={false}
              placeholder="#ff8800"
              maxLength={7}
              style={{ width: 100 }}
            />
            <span
              className="custom-color-preview"
              style={{ background: previewColor, color: previewText }}
            >
              {label.trim() || '预览'}
            </span>
          </div>
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
