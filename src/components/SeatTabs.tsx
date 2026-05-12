import { useMemo } from 'react';
import { rangeActions, useDraft } from '@/store/useRangeStore';
import { SEAT_FULL_LABEL, seatsForCount, type SeatId } from '@/lib/seats';
import { countNonFold, isOpponentIndependent } from '@/lib/depths';
import styles from '@/styles/seatTabs.module.css';

export function SeatTabs() {
  const draft = useDraft();
  const {
    rangeId,
    seats,
    currentSeatId,
    currentDepthLabel,
    currentOpponentId,
    depths,
  } = draft;

  const order = useMemo(() => seatsForCount(seats), [seats]);

  // 对战候选：剔除当前选中的英雄座位（与英雄座位互斥）
  const opponentOrder = useMemo(
    () => order.filter((s) => s !== currentSeatId),
    [order, currentSeatId],
  );

  const currentDepth = useMemo(
    () => depths.find((d) => d.label === currentDepthLabel) ?? null,
    [depths, currentDepthLabel],
  );

  const heroBucket = currentSeatId ? currentDepth?.seats[currentSeatId] : undefined;

  if (!rangeId) {
    return null;
  }

  const onSwitchSeat = (seatId: SeatId) => {
    if (seatId === currentSeatId) return;
    rangeActions.switchSeat(seatId);
  };

  const onSwitchOpponent = (oppId: SeatId) => {
    // 再次点击当前已选中的对战 → 取消选中，回到「总体」状态（null）。
    // 这是隐藏「总体」按钮后用户回到总体视图的唯一途径之一（另一种是切换英雄座位）。
    const next = oppId === currentOpponentId ? null : oppId;
    rangeActions.switchOpponent(next);
  };

  return (
    <div className={styles.group}>
      <div className={styles.row} role="tablist" aria-label="座位">
        <div className={styles.tabs}>
          {order.map((seatId) => {
            const active = seatId === currentSeatId;
            // 座位按钮的命中数 = 该座位「总体」(overall) 的命中数
            const bucket = currentDepth?.seats[seatId];
            const marks = bucket ? countNonFold(bucket.overall) : 0;
            return (
              <button
                key={seatId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.tab} ${active ? styles.active : ''}`}
                title={`${SEAT_FULL_LABEL[seatId]}${
                  currentDepthLabel ? ` · ${currentDepthLabel}` : ''
                }${marks > 0 ? ` · 总体 ${marks}/169` : ''}`}
                onClick={() => onSwitchSeat(seatId)}
              >
                <span className={styles.tabLabel}>{seatId}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.row} role="tablist" aria-label="对战">
        <div className={styles.tabs}>
          {/*
           * 不再渲染显式的「总体」按钮。
           * - 当 currentOpponentId === null 时即处于「总体」模式，对战行无按钮高亮。
           * - 切换英雄座位会自动重置回总体；再次点击已选中的对战按钮也会回到总体。
           */}
          {opponentOrder.map((seatId) => {
            const active = seatId === currentOpponentId;
            const independent = isOpponentIndependent(heroBucket, seatId);
            // 已独立 → 显示自己的命中数；未独立 → 显示 overall 的命中数（灰色提示是继承）
            const cells = independent
              ? heroBucket?.vs[seatId]
              : heroBucket?.overall;
            const marks = cells ? countNonFold(cells) : 0;
            const tip = independent
              ? `对战 ${SEAT_FULL_LABEL[seatId]} · 独立${
                  marks > 0 ? ` · ${marks}/169` : '（空表）'
                }`
              : `对战 ${SEAT_FULL_LABEL[seatId]} · 跟随总体${
                  marks > 0 ? `（${marks}/169）` : ''
                }`;
            return (
              <button
                key={seatId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.tab} ${active ? styles.active : ''} ${
                  independent ? styles.independent : styles.inherited
                }`}
                title={tip}
                onClick={() => onSwitchOpponent(seatId)}
              >
                <span className={styles.tabLabel}>{seatId}</span>
                {independent && (
                  <span
                    className={styles.indDot}
                    aria-label="已独立"
                    title="已独立编辑（与总体不同）"
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
