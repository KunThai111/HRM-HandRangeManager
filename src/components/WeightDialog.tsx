import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bestTextColorOn,
  clampWeight,
  resolveActionOrFold,
  type CellSegment,
  type CustomAction,
} from '@/lib/colors';
import styles from '@/styles/dialog.module.css';

interface Props {
  /** 当前 hand 文案（如 `AKs`），仅用于标题显示。 */
  hand: string;
  /** 该 range 下所有可选的自定义动作（按出现顺序）。 */
  customActions: readonly CustomAction[];
  /** 弹窗打开时该格已有的分段（已合并 / 已夹紧）。空数组 = 当前是 fold。 */
  initial: readonly CellSegment[];
  /**
   * 用于"快捷预填"：进入弹窗时若 cell 还没有任何 segment，
   * 则把这个动作填到第一行，初始 50%。可为 null（不预填，进来全是 fold）。
   */
  primaryAction: string | null;
  onCancel: () => void;
  onConfirm: (segments: CellSegment[]) => void;
}

/**
 * 多动作占比对话框：
 * - 列出该 range 所有 customActions，每行一个 0–100 的滑块/输入
 * - 自动显示「Fold」剩余 = max(0, 100 - sum)
 * - 用户在某行修改时，若总和超出 100，自动把最早的旧权重按比例缩减以挪出空间
 *   （fold 段会优先被吃掉；动作段按比例缩减）
 * - 确定后回调一份新的 segments；空数组 = 该格设回 fold
 */
export function WeightDialog({
  hand,
  customActions,
  initial,
  primaryAction,
  onCancel,
  onConfirm,
}: Props) {
  /** id → weight 的内部状态；fold 不进入此 map。 */
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const s of initial) {
      if (s.id !== 'fold') out[s.id] = clampWeight(s.weight);
    }
    // 若空且 primaryAction 是有效 custom，初始 50%（便于一进来就有的拖）
    if (
      Object.keys(out).length === 0 &&
      primaryAction &&
      primaryAction !== 'fold' &&
      customActions.some((c) => c.id === primaryAction)
    ) {
      out[primaryAction] = 50;
    }
    return out;
  });

  const firstInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    firstInputRef.current?.focus();
    firstInputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** 当前动作权重总和（不含 fold）。 */
  const actionSum = useMemo(() => {
    let s = 0;
    for (const id of Object.keys(weights)) s += weights[id] ?? 0;
    return s;
  }, [weights]);
  const foldWeight = Math.max(0, 100 - actionSum);
  const overflow = actionSum > 100;

  /** 改某一行：把它写到 `nextValue`，其它行不动；若超出 100，把"其它行"按比例缩减以让出空间。 */
  const setOne = (id: string, nextRaw: number) => {
    const next = Math.max(0, Math.min(100, Math.round(nextRaw || 0)));
    setWeights((prev) => {
      const others = Object.entries(prev).filter(([k]) => k !== id);
      const othersSum = others.reduce((acc, [, v]) => acc + v, 0);
      const headroom = 100 - next;
      const out: Record<string, number> = {};
      if (othersSum <= headroom || othersSum === 0) {
        // 其它行保持
        for (const [k, v] of others) {
          if (v > 0) out[k] = v;
        }
      } else {
        // 按比例缩减其它行，使总和 = headroom；至少保留 1（如果原本 > 0）
        const ratio = headroom / othersSum;
        let assigned = 0;
        const adjusted: Array<[string, number]> = [];
        for (const [k, v] of others) {
          if (v <= 0) continue;
          const scaled = Math.max(0, Math.round(v * ratio));
          adjusted.push([k, scaled]);
          assigned += scaled;
        }
        // 四舍五入误差修正：让 assigned 严格 = headroom
        let diff = headroom - assigned;
        if (diff !== 0 && adjusted.length > 0) {
          // 把误差均摊到第一段（简单粗暴，足够 1-2 误差）
          adjusted[0][1] = Math.max(0, adjusted[0][1] + diff);
        }
        for (const [k, v] of adjusted) {
          if (v > 0) out[k] = v;
        }
      }
      if (next > 0) out[id] = next;
      return out;
    });
  };

  const reset = () => setWeights({});

  const submit = () => {
    if (overflow) return;
    const segs: CellSegment[] = [];
    for (const ca of customActions) {
      const w = weights[ca.id];
      if (w && w > 0) segs.push({ id: ca.id, weight: clampWeight(w) });
    }
    // 不在 customActions 列表里但仍有权重的（旧数据 / 已删除的 action）：保留以免误删
    for (const id of Object.keys(weights)) {
      if (customActions.some((c) => c.id === id)) continue;
      const w = weights[id];
      if (w && w > 0) segs.push({ id, weight: clampWeight(w) });
    }
    onConfirm(segs);
  };

  const fold = resolveActionOrFold('fold', customActions);
  // 预览：横向多段渐变（按用户当前权重，不依赖 makeCellValue）
  const preview = useMemo(() => {
    const stops: string[] = [];
    let acc = 0;
    for (const ca of customActions) {
      const w = weights[ca.id];
      if (!w || w <= 0) continue;
      const start = acc;
      const end = acc + w;
      stops.push(`${ca.color} ${start}% ${end}%`);
      acc = end;
    }
    if (acc < 100) {
      stops.push(`${fold.color} ${acc}% 100%`);
    }
    return stops.length > 0
      ? `linear-gradient(to right, ${stops.join(', ')})`
      : fold.color;
  }, [customActions, weights, fold.color]);

  // 没有任何 custom action 时不允许混合
  const hasActions = customActions.length > 0;

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="设置该格的多动作占比"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <div className={styles.title}>
          {hand} · 多动作占比
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.hint}>
          按住 Cmd / Ctrl 点击格子打开本对话框。可以为同一格设置多个动作各自的占比（每行 0–100%），
          所有动作权重之和不超过 100；剩余部分按 Fold 渲染。
        </div>

        {!hasActions ? (
          <div className={styles.empty}>该范围还没有任何动作按钮，先在工具栏点「+ 添加按钮」。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {customActions.map((ca, idx) => {
              const w = weights[ca.id] ?? 0;
              return (
                <ActionRow
                  key={ca.id}
                  action={ca}
                  value={w}
                  inputRef={idx === 0 ? firstInputRef : undefined}
                  onChange={(v) => setOne(ca.id, v)}
                />
              );
            })}
            <div
              className={styles.fieldHint}
              style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}
            >
              <span>
                动作合计 <strong style={{ color: overflow ? 'var(--danger)' : 'var(--text-1)' }}>{actionSum}%</strong>
                {foldWeight > 0 && (
                  <>
                    {'，剩余 '}
                    <strong style={{ color: 'var(--text-1)' }}>{foldWeight}% Fold</strong>
                  </>
                )}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={reset}
                title="清空所有动作（保存后该格回到 Fold）"
              >
                清空
              </button>
            </div>
            {overflow && (
              <div className={styles.error}>
                动作合计超过 100%（{actionSum}%），无法保存。
              </div>
            )}
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>预览</span>
          <div
            style={{
              height: 48,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: preview,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
              color: bestTextColorOn(fold.color),
              fontSize: 13,
            }}
          >
            {hand}
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={overflow || !hasActions}
            title={overflow ? '动作合计需 ≤ 100%' : ''}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  action: CustomAction;
  value: number;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (next: number) => void;
}

function ActionRow({ action, value, inputRef, onChange }: RowProps) {
  const [text, setText] = useState(String(value));
  // 父级 value 变化（被自动缩减）时同步输入框
  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 64px 16px',
        alignItems: 'center',
        gap: 10,
        padding: '4px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          className="action-dot"
          style={{ background: action.color, flexShrink: 0 }}
          aria-hidden
        />
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: 13,
          }}
          title={action.label}
        >
          {action.label}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
        aria-label={`${action.label} 占比`}
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
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)));
        }}
        onBlur={() => {
          const n = parseInt(text, 10);
          if (!Number.isFinite(n)) setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        style={{ width: 56, textAlign: 'right' }}
        aria-label={`${action.label} 占比数值`}
      />
      <span style={{ color: 'var(--text-2)', fontSize: 12 }}>%</span>
    </div>
  );
}
