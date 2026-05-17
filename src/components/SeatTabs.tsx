import { useMemo } from 'react';
import { rangeActions, useDraft } from '@/store/useRangeStore';
import { SEAT_FULL_LABEL, seatsForCount, type SeatId } from '@/lib/seats';
import {
  countNonFold,
  getCellsForSeat,
  isSeatIndependent,
} from '@/lib/depths';
import styles from '@/styles/seatTabs.module.css';

export function SeatTabs() {
  const draft = useDraft();
  const { rangeId, seats, currentSeatId, currentDepthLabel, depths } = draft;

  const order = useMemo(() => seatsForCount(seats), [seats]);

  const currentDepth = useMemo(
    () => depths.find((d) => d.label === currentDepthLabel) ?? null,
    [depths, currentDepthLabel],
  );

  if (!rangeId) {
    return null;
  }

  const onSwitchSeat = (seatId: SeatId) => {
    if (seatId === currentSeatId) return;
    rangeActions.switchSeat(seatId);
  };

  return (
    <div className={styles.group}>
      <div className={styles.row} role="tablist" aria-label="座位">
        <div className={styles.tabs}>
          {order.map((seatId) => {
            const active = seatId === currentSeatId;
            // 命中数：独立 → 自己的 cells；否则 → sharedCells
            const cells = currentDepth ? getCellsForSeat(currentDepth, seatId) : null;
            const marks = cells ? countNonFold(cells) : 0;
            const independent = currentDepth
              ? isSeatIndependent(currentDepth, seatId)
              : false;
            const tip = `${SEAT_FULL_LABEL[seatId]}${
              currentDepthLabel ? ` · ${currentDepthLabel}` : ''
            }${marks > 0 ? ` · ${marks}/169` : ''}${
              independent ? ' · 已独立' : ''
            }`;
            return (
              <button
                key={seatId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.tab} ${active ? styles.active : ''}`}
                title={tip}
                onClick={() => onSwitchSeat(seatId)}
              >
                <span className={styles.tabLabel}>{seatId}</span>
                {independent && (
                  <span
                    className={styles.indDot}
                    aria-label="已独立"
                    title="已独立编辑（与共享范围不同）"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
