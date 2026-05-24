import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_HAND_KEYS, RANKS, cellKey, rectHands } from '@/lib/hands';
import {
  cellSegments,
  resolveAction,
  resolveActionOrFold,
  type Action,
  type CellSegment,
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
  /**
   * 切换放大格子的回调（用于关闭 / 切到另一格）。
   * - 编辑模式下 Alt/Option+左键会带 `editNote: true`，请求 RangeDetail 进入「备注编辑」子模式。
   */
  onZoomChange: (hand: string | null, opts?: { editNote?: boolean }) => void;
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
  /**
   * 编辑模式下 Shift+点击的矩形锚点：上一次普通点击/Shift 点击命中的 hand。
   * - 普通左键单击 / Shift 左键单击 / 拖拽涂色（在格子间移动）都会刷新它
   * - 切换 depth / hero / vs / 退出编辑模式时重置为 null
   */
  const shiftAnchorRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /** Cmd/Ctrl + 点击触发的多动作占比弹窗：存当前编辑的 hand + 进入时的分段。 */
  const [mixTarget, setMixTarget] = useState<{
    hand: string;
    initial: CellSegment[];
  } | null>(null);

  useEffect(() => {
    // 没激活范围时，永远关闭放大态。
    // 编辑模式下也允许放大（Alt+点击进入备注编辑），所以只有 hasActive 缺失时才强关。
    if (!hasActive) {
      if (zoomedHand !== null) onZoomChange(null);
    }
  }, [hasActive, zoomedHand, onZoomChange]);

  useEffect(() => {
    shiftAnchorRef.current = null;
  }, [
    draft.currentDepthLabel,
    draft.currentSeatId,
    draft.currentVsSeatId,
    draft.editing,
  ]);

  useEffect(() => {
    if (zoomedHand === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onZoomChange(null);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
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

  const openMixDialog = (hand: string) => {
    const raw = cells[hand];
    const initial = cellSegments(raw);
    setMixTarget({ hand, initial });
  };

  const applyRect = useCallback(
    (anchor: string, target: string, action: Action) => {
      if (!editable) return;
      if (action !== 'fold') {
        if (!action) return;
        if (!customActions.some((c) => c.id === action)) return;
      }
      const hands = rectHands(anchor, target);
      if (hands.length === 0) return;
      rangeActions.paintCells(hands, action);
    },
    [editable, customActions],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, hand: string) => {
    if (!editable) {
      if (!hasActive) return;
      if (e.button !== 0) return;
      const segs = cellSegments(cells[hand]);
      if (segs.length === 0) {
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
      shiftAnchorRef.current = hand;
      return;
    }
    if (e.button !== 0) return;
    // Alt / Option + 左键：在编辑模式下打开 RangeDetail 并直接进入「备注编辑」子模式
    if (e.altKey) {
      e.preventDefault();
      onZoomChange(hand, { editNote: true });
      return;
    }
    // Cmd / Ctrl + 左键：打开多动作占比对话框（不要求一定先选了画笔）
    if (e.metaKey || e.ctrlKey) {
      if (customActions.length === 0) return;
      e.preventDefault();
      openMixDialog(hand);
      return;
    }
    // Shift + 左键：以上一次点击的格子为锚点，对矩形区域批量涂色
    if (e.shiftKey) {
      e.preventDefault();
      if (!hasSelectedAction) return;
      const anchor = shiftAnchorRef.current;
      if (anchor && anchor !== hand) {
        applyRect(anchor, hand, currentAction);
      } else {
        apply(hand, currentAction);
      }
      shiftAnchorRef.current = hand;
      return;
    }
    if (!hasSelectedAction) return;
    e.preventDefault();
    paintingRef.current.active = true;
    paintingRef.current.action = currentAction;
    apply(hand, currentAction);
    shiftAnchorRef.current = hand;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const onPointerEnter = (hand: string) => {
    if (!paintingRef.current.active || paintingRef.current.action == null) return;
    apply(hand, paintingRef.current.action);
    shiftAnchorRef.current = hand;
  };

  const onTouchMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!paintingRef.current.active || paintingRef.current.action == null) return;
    if (e.pointerType !== 'touch') return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!(el instanceof HTMLElement)) return;
    const hand = el.dataset.hand;
    if (hand) {
      apply(hand, paintingRef.current.action);
      shiftAnchorRef.current = hand;
    }
  };

  // 非编辑模式下，若用户已选中一个有效动作 → 进入「筛选/高亮」模式：
  // 只有「该格包含 filterAction」的保持原色，其余置灰
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

  const fold = resolveAction('fold')!;

  return (
    <div className={styles.gridWrap}>
      <div
        className={gridClass}
        ref={gridRef}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={onTouchMove}
        onPointerDown={(e) => {
          if (!editable && zoomedHand !== null && e.target === e.currentTarget) {
            onZoomChange(null);
          }
        }}
      >
        {ALL_HAND_KEYS.map((hand, idx) => {
          const row = Math.floor(idx / RANKS.length);
          const col = idx % RANKS.length;
          const rawValue = cells[hand] ?? '';
          const segs = cellSegments(rawValue);
          const dimmed = filterAction !== null && !segs.some((s) => s.id === filterAction);

          // 计算背景：N 段水平渐变 + 剩余 fold；空段视为整格 fold
          // dim 时整格涂背景灰，避免颜色花
          let bg: string;
          let fg: string;
          if (dimmed) {
            bg = 'var(--bg-2)';
            fg = 'var(--text-2)';
          } else if (segs.length === 0) {
            bg = fold.color;
            fg = fold.textColor;
          } else {
            const stops: string[] = [];
            let acc = 0;
            for (const s of segs) {
              const col = resolveActionOrFold(s.id, customActions).color;
              const start = acc;
              const end = Math.min(100, acc + s.weight);
              stops.push(`${col} ${start}% ${end}%`);
              acc = end;
            }
            if (acc < 100) {
              stops.push(`${fold.color} ${acc}% 100%`);
            }
            // 单段 100%：直接用纯色（避免 gradient 渲染开销）
            if (segs.length === 1 && segs[0].weight >= 100) {
              const r = resolveActionOrFold(segs[0].id, customActions);
              bg = r.color;
              fg = r.textColor;
            } else {
              bg = `linear-gradient(to right, ${stops.join(', ')})`;
              // 多段或部分填充：文字落在第一段上 → 用第一段的 textColor
              const first = resolveActionOrFold(segs[0].id, customActions);
              fg = first.textColor;
            }
          }

          // 放大态：左右角标
          // - 单段部分填充：左 = 动作色 weight%，右 = fold (100-w)%
          // - 多段：左 = 第一段 id label + 权重，右 = 总 fold 比例（若有）
          // - 全填充 / 全 fold：不显示
          const totalActionWeight = segs.reduce((acc, s) => acc + s.weight, 0);
          const isPartialSingle =
            !dimmed && segs.length === 1 && segs[0].weight < 100;
          const isMulti = !dimmed && segs.length > 1;
          const k = cellKey(row, col);
          const zoomed = zoomedHand === hand;
          const cellClass = [
            styles.cell,
            dimmed ? styles.cellDimmed : '',
            zoomed ? styles.cellZoomed : '',
          ]
            .filter(Boolean)
            .join(' ');
          const originX = (col / (RANKS.length - 1)) * 100;
          const originY = (row / (RANKS.length - 1)) * 100;
          const cellStyle: React.CSSProperties = {
            background: bg,
            color: fg,
          };
          if (zoomed) {
            cellStyle.transformOrigin = `${originX}% ${originY}%`;
          }

          // 角标内容
          let leftPct: { color: string; text: string } | null = null;
          let rightPct: { color: string; text: string } | null = null;
          if (isPartialSingle) {
            const r = resolveActionOrFold(segs[0].id, customActions);
            leftPct = { color: r.textColor, text: `${segs[0].weight}%` };
            rightPct = { color: fold.textColor, text: `${100 - segs[0].weight}%` };
          } else if (isMulti) {
            const first = resolveActionOrFold(segs[0].id, customActions);
            leftPct = { color: first.textColor, text: `${segs[0].weight}%` };
            const restFold = 100 - totalActionWeight;
            if (restFold > 0) {
              rightPct = { color: fold.textColor, text: `${restFold}%` };
            } else {
              // 没有 fold 剩余：右侧显示最后一段的 weight
              const last = segs[segs.length - 1];
              const lr = resolveActionOrFold(last.id, customActions);
              rightPct = { color: lr.textColor, text: `${last.weight}%` };
            }
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
              {leftPct && (
                <span
                  className={styles.cellPctLeft}
                  style={{ color: leftPct.color }}
                  aria-hidden
                >
                  {leftPct.text}
                </span>
              )}
              {rightPct && (
                <span
                  className={styles.cellPctRight}
                  style={{ color: rightPct.color }}
                  aria-hidden
                >
                  {rightPct.text}
                </span>
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
      {mixTarget && editable && (
        <WeightDialog
          hand={mixTarget.hand}
          customActions={customActions}
          initial={mixTarget.initial}
          primaryAction={currentAction || null}
          onCancel={() => setMixTarget(null)}
          onConfirm={(segs) => {
            rangeActions.paintCellMix(mixTarget.hand, segs);
            setMixTarget(null);
          }}
        />
      )}
    </div>
  );
}
