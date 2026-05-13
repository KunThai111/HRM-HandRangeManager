import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_HAND_KEYS, RANKS, cellKey } from '@/lib/hands';
import { resolveActionOrFold, type Action } from '@/lib/colors';
import {
  getCurrentCells,
  rangeActions,
  useCustomActions,
  useDraft,
} from '@/store/useRangeStore';
import styles from '@/styles/grid.module.css';

interface Props {
  currentAction: Action;
}

export function RangeGrid({ currentAction }: Props) {
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
  const [zoomedHand, setZoomedHand] = useState<string | null>(null);

  // 进入编辑模式或切换激活子表时，自动关闭放大态
  useEffect(() => {
    if (editable || !hasActive) setZoomedHand(null);
  }, [editable, hasActive]);

  // 非编辑模式下：ESC / 点击外部关闭放大
  useEffect(() => {
    if (zoomedHand === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedHand(null);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (gridRef.current && target && !gridRef.current.contains(target)) {
        setZoomedHand(null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [zoomedHand]);

  const apply = useCallback(
    (hand: string, action: Action) => {
      if (!editable) return;
      // fold 等价「清空格子」，任何时候都可写；其它动作必须是已存在的 custom id
      if (action !== 'fold') {
        if (!action) return;
        if (!customActions.some((c) => c.id === action)) return;
      }
      rangeActions.paintCell(hand, action);
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
      e.preventDefault();
      setZoomedHand((cur) => (cur === hand ? null : hand));
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      apply(hand, 'fold');
      return;
    }
    if (e.button !== 0) return;
    if (!hasSelectedAction) return;
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
      >
        {ALL_HAND_KEYS.map((hand, idx) => {
          const row = Math.floor(idx / RANKS.length);
          const col = idx % RANKS.length;
          const action: Action = cells[hand] ?? 'fold';
          const resolved = resolveActionOrFold(action, customActions);
          const dimmed = filterAction !== null && action !== filterAction;
          const bg = dimmed ? 'var(--bg-2)' : resolved.color;
          const fg = dimmed ? 'var(--text-2)' : resolved.textColor;
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
              {hand}
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
    </div>
  );
}
