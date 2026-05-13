import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_HAND_KEYS, RANKS, cellKey } from '@/lib/hands';
import {
  cellId,
  cellWeight,
  resolveAction,
  resolveActionOrFold,
  type Action,
} from '@/lib/colors';
import {
  getCurrentCells,
  rangeActions,
  useCustomActions,
  useDraft,
} from '@/store/useRangeStore';
import styles from '@/styles/grid.module.css';
import { WeightDialog } from './WeightDialog';

interface Props {
  currentAction: Action;
  /** 当前被放大的格子（受控）。null = 无放大。 */
  zoomedHand: string | null;
  /** 切换放大格子的回调（用于关闭 / 切到另一格）。 */
  onZoomChange: (hand: string | null) => void;
}

export function RangeGrid({ currentAction, zoomedHand, onZoomChange }: Props) {
  const draft = useDraft();
  const customActions = useCustomActions();
  const cells = getCurrentCells(draft);
  const hasActive =
    !!draft.rangeId && !!draft.currentDepthLabel && !!draft.currentSeatId;
  const editable = hasActive && draft.editing;

  const paintingRef = useRef<{ active: boolean; action: Action | null }>({
    active: false,
    action: null,
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** Cmd/Ctrl + 点击触发的权重输入弹窗状态。 */
  const [weightTarget, setWeightTarget] = useState<{
    hand: string;
    action: Action;
    initial: number;
  } | null>(null);

  // 进入编辑模式或切换激活子表时，自动关闭放大态
  useEffect(() => {
    if (editable || !hasActive) {
      if (zoomedHand !== null) onZoomChange(null);
    }
  }, [editable, hasActive, zoomedHand, onZoomChange]);

  // 非编辑模式下：ESC / 点击外部关闭放大
  useEffect(() => {
    if (zoomedHand === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onZoomChange(null);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // 点到网格内 / 详情面板内都不算「外部」，避免在详情面板里输入备注就把放大关掉
      if (gridRef.current && gridRef.current.contains(target)) return;
      if (target instanceof Element && target.closest('[data-range-detail]')) return;
      onZoomChange(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [zoomedHand, onZoomChange]);

  const apply = useCallback(
    (hand: string, action: Action, weight: number = 100) => {
      if (!editable) return;
      // fold 等价「清空格子」，任何时候都可写；其它动作必须是已存在的 custom id
      if (action !== 'fold') {
        if (!action) return;
        if (!customActions.some((c) => c.id === action)) return;
      }
      rangeActions.paintCell(hand, action, weight);
    },
    [editable, customActions],
  );

  useEffect(() => {
    const handleUp = () => {
      paintingRef.current.active = false;
      paintingRef.current.action = null;
    };
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, []);

  const hasSelectedAction =
    currentAction === 'fold' ||
    (!!currentAction && customActions.some((c) => c.id === currentAction));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, hand: string) => {
    if (!editable) {
      // 非编辑模式：左键单击切换该格的放大态
      if (!hasActive) return;
      if (e.button !== 0) return;
      // 未标注颜色（fold / 未设置）的格子不放大；若已有其它放大格，关闭它
      const cellAction = cells[hand];
      if (!cellAction || cellAction === 'fold') {
        if (zoomedHand !== null) {
          e.preventDefault();
          onZoomChange(null);
        }
        return;
      }
      e.preventDefault();
      onZoomChange(zoomedHand === hand ? null : hand);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      apply(hand, 'fold');
      return;
    }
    if (e.button !== 0) return;
    if (!hasSelectedAction) return;
    // Cmd（mac）/ Ctrl（win）+ 左键单击 → 弹出权重输入框，自定义该格的操作占比。
    // fold 不支持部分填充（fold 等价清空，没有占比概念）。
    if ((e.metaKey || e.ctrlKey) && currentAction !== 'fold') {
      e.preventDefault();
      const existing = cells[hand];
      const initial =
        existing && cellId(existing) === currentAction ? cellWeight(existing) : 50;
      setWeightTarget({ hand, action: currentAction, initial });
      return;
    }
    e.preventDefault();
    paintingRef.current.active = true;
    paintingRef.current.action = currentAction;
    apply(hand, currentAction);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const onPointerEnter = (hand: string) => {
    if (!paintingRef.current.active || paintingRef.current.action == null) return;
    apply(hand, paintingRef.current.action);
  };

  const onTouchMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!paintingRef.current.active || paintingRef.current.action == null) return;
    if (e.pointerType !== 'touch') return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!(el instanceof HTMLElement)) return;
    const hand = el.dataset.hand;
    if (hand) apply(hand, paintingRef.current.action);
  };

  // 非编辑模式下，若用户已选中一个有效动作 → 进入「筛选/高亮」模式：只有该动作的格子保持原色，其它格子置灰
  const filterAction =
    !editable && hasSelectedAction && currentAction !== 'fold' ? currentAction : null;

  const gridClass = [
    styles.grid,
    !hasActive ? styles.gridDisabled : '',
    hasActive && !editable ? styles.gridReadOnly : '',
    editable ? styles.gridEditing : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.gridWrap}>
      <div
        className={gridClass}
        ref={gridRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={onTouchMove}
        onPointerDown={(e) => {
          // 点击网格内空白间隙（非 cell 区域）→ 关闭放大态
          if (!editable && zoomedHand !== null && e.target === e.currentTarget) {
            onZoomChange(null);
          }
        }}
      >
        {ALL_HAND_KEYS.map((hand, idx) => {
          const row = Math.floor(idx / RANKS.length);
          const col = idx % RANKS.length;
          const rawValue = cells[hand] ?? 'fold';
          const actionId: Action = cellId(rawValue);
          const weight = rawValue === 'fold' ? 100 : cellWeight(rawValue);
          const resolved = resolveActionOrFold(actionId, customActions);
          // 过滤模式下：只比对 id 部分（c_xxx@30 也应被视为 c_xxx 的命中）
          const dimmed = filterAction !== null && actionId !== filterAction;
          const fold = resolveAction('fold')!;
          const foldColor = fold.color;
          const foldTextColor = fold.textColor;
          const fillColor = dimmed ? 'var(--bg-2)' : resolved.color;
          // 部分填充：自左向右画动作色 0% → weight%，剩余为 fold 背景色
          const isPartial = !dimmed && actionId !== 'fold' && weight < 100;
          const bg = isPartial
            ? `linear-gradient(to right, ${fillColor} 0% ${weight}%, ${foldColor} ${weight}% 100%)`
            : fillColor;
          // 文字色：部分填充时左右两段背景对比较强（动作色 + fold 背景），
          // 用 fold 的深色文字在 fold 段保证可读
          const fg = dimmed
            ? 'var(--text-2)'
            : isPartial
              ? foldTextColor
              : resolved.textColor;
          const k = cellKey(row, col);
          const zoomed = zoomedHand === hand;
          const cellClass = [
            styles.cell,
            dimmed ? styles.cellDimmed : '',
            zoomed ? styles.cellZoomed : '',
          ]
            .filter(Boolean)
            .join(' ');
          // 让放大锚点贴向 cell 在网格中的相对位置，保证缩放后不溢出 grid 容器
          const originX = (col / (RANKS.length - 1)) * 100;
          const originY = (row / (RANKS.length - 1)) * 100;
          const cellStyle: React.CSSProperties = {
            background: bg,
            color: fg,
          };
          if (zoomed) {
            cellStyle.transformOrigin = `${originX}% ${originY}%`;
          }
          return (
            <div
              key={k}
              data-hand={hand}
              className={cellClass}
              style={cellStyle}
              onPointerDown={(e) => onPointerDown(e, hand)}
              onPointerEnter={() => onPointerEnter(hand)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editable) apply(hand, 'fold');
              }}
            >
              <span className={styles.cellLabel}>{hand}</span>
              {isPartial && (
                <>
                  <span
                    className={styles.cellPctLeft}
                    style={{ color: resolved.textColor }}
                    aria-hidden
                  >
                    {weight}%
                  </span>
                  <span
                    className={styles.cellPctRight}
                    style={{ color: foldTextColor }}
                    aria-hidden
                  >
                    {100 - weight}%
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {!hasActive && (
        <div className={styles.placeholder}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              先选择或新建一个范围
            </div>
            <div style={{ color: 'var(--text-2)' }}>
              在左侧栏点击已有范围，或点击 「+ 新建范围」 开始
            </div>
          </div>
        </div>
      )}
      {weightTarget && editable && (
        <WeightDialog
          hand={weightTarget.hand}
          action={resolveActionOrFold(weightTarget.action, customActions)}
          initial={weightTarget.initial}
          onCancel={() => setWeightTarget(null)}
          onConfirm={(w) => {
            apply(weightTarget.hand, weightTarget.action, w);
            setWeightTarget(null);
          }}
        />
      )}
    </div>
  );
}
