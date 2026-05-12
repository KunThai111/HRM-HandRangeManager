import { useCallback, useEffect, useRef } from 'react';
import { ALL_HAND_KEYS, RANKS, cellKey } from '@/lib/hands';
import { ACTION_COLOR, ACTION_TEXT_COLOR, type Action } from '@/lib/colors';
import {
  getCurrentDepthCells,
  rangeActions,
  useDraft,
} from '@/store/useRangeStore';
import styles from '@/styles/grid.module.css';

interface Props {
  currentAction: Action;
}

export function RangeGrid({ currentAction }: Props) {
  const draft = useDraft();
  const cells = getCurrentDepthCells(draft);
  const hasActive = !!draft.rangeId && !!draft.currentDepthLabel;
  const editable = hasActive && draft.editing;

  const paintingRef = useRef<{ active: boolean; action: Action | null }>({
    active: false,
    action: null,
  });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const apply = useCallback(
    (hand: string, action: Action) => {
      if (!editable) return;
      rangeActions.paintCell(hand, action);
    },
    [editable],
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, hand: string) => {
    if (!editable) return;
    if (e.button === 2) {
      e.preventDefault();
      apply(hand, 'fold');
      return;
    }
    if (e.button !== 0) return;
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
          const bg = ACTION_COLOR[action];
          const fg = ACTION_TEXT_COLOR[action];
          const k = cellKey(row, col);
          return (
            <div
              key={k}
              data-hand={hand}
              className={styles.cell}
              style={{ background: bg, color: fg }}
              onPointerDown={(e) => onPointerDown(e, hand)}
              onPointerEnter={() => onPointerEnter(hand)}
              onContextMenu={(e) => {
                e.preventDefault();
                apply(hand, 'fold');
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
