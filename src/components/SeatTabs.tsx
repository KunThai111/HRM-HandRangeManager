import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { rangeActions, useDraft } from '@/store/useRangeStore';
import {
  SEAT_FULL_LABEL,
  getOtherSeats,
  seatsForCount,
  type SeatId,
} from '@/lib/seats';
import type { DepthGrid } from '@/lib/depths';
import {
  countNonFold,
  getActiveVsSeats,
  getCellsForSeat,
  getCellsForVs,
  isSeatIndependent,
  isVsSeatIndependent,
} from '@/lib/depths';
import styles from '@/styles/seatTabs.module.css';

/** 判断鼠标事件是否带有"添加/删除对战座位"的修饰键（macOS=⌘，其它=Ctrl）。 */
function isVsModifier(e: ReactMouseEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function SeatTabs() {
  const draft = useDraft();
  const {
    rangeId,
    seats,
    currentSeatId,
    currentVsSeatId,
    currentDepthLabel,
    depths,
    editing,
  } = draft;

  const order = useMemo(() => seatsForCount(seats), [seats]);

  const currentDepth = useMemo(
    () => depths.find((d) => d.label === currentDepthLabel) ?? null,
    [depths, currentDepthLabel],
  );

  if (!rangeId) {
    return null;
  }

  const onClickSeat = (seatId: SeatId, e: ReactMouseEvent<HTMLButtonElement>) => {
    // 编辑模式下，⌘/Ctrl + 点击其它座位 = 快捷添加为对战座位并切换过去
    if (editing && isVsModifier(e) && currentSeatId) {
      if (seatId !== currentSeatId) {
        rangeActions.addVsSeat(seatId);
        return;
      }
      // ⌘/Ctrl + 点击 hero 自身 → 静默忽略（不能与自己对战）
      return;
    }
    if (seatId === currentSeatId) return;
    rangeActions.switchSeat(seatId);
  };

  return (
    <div className={styles.group}>
      <div className={styles.row} role="tablist" aria-label="座位">
        <div className={styles.tabs}>
          {order.map((seatId) => {
            const active = seatId === currentSeatId;
            const cells = currentDepth ? getCellsForSeat(currentDepth, seatId) : null;
            const marks = cells ? countNonFold(cells) : 0;
            const independent = currentDepth
              ? isSeatIndependent(currentDepth, seatId)
              : false;
            const canAddAsVs =
              !!currentSeatId && seatId !== currentSeatId;
            const tip = `${SEAT_FULL_LABEL[seatId]}${
              currentDepthLabel ? ` · ${currentDepthLabel}` : ''
            }${marks > 0 ? ` · ${marks}/169` : ''}${
              independent ? ' · 已独立' : ''
            }${
              editing && canAddAsVs ? ' · ⌘点击 = 添加为对战座位' : ''
            }`;
            return (
              <button
                key={seatId}
                type="button"
                role="tab"
                aria-selected={active}
                className={`${styles.tab} ${active ? styles.active : ''}`}
                title={tip}
                onClick={(e) => onClickSeat(seatId, e)}
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

      {currentSeatId && currentDepth && (
        <VsSeatTabs
          heroSeatId={currentSeatId}
          currentVsSeatId={currentVsSeatId}
          seats={seats}
          editing={editing}
          depth={currentDepth}
        />
      )}
    </div>
  );
}

interface VsSeatTabsProps {
  heroSeatId: string;
  currentVsSeatId: string | null;
  seats: number;
  editing: boolean;
  depth: DepthGrid;
}

/**
 * 对战座位（vs_seat）行。
 *
 * 显示规则：
 * - 当 hero 有其它合法座位（getOtherSeats 非空）时显示；hero 不在当前桌序列时不渲染。
 * - 首位永远是 "RFI" 按钮（= 默认/开池视图，currentVsSeatId=null）。
 * - 后续按钮 = 用户已显式添加的对战座位（按位置序排列）。
 * - 编辑模式下额外显示「+」按钮，点击展开下拉菜单选择剩余座位。
 *
 * 操作语义：
 * - 普通点击对战按钮 → switchVsSeat。
 * - 编辑模式下 ⌘/Ctrl + 点击已添加的对战按钮 → removeVsSeat。
 * - 编辑模式下 ⌘/Ctrl + 点击 RFI 按钮 → 无意义（静默忽略）。
 */
function VsSeatTabs({
  heroSeatId,
  currentVsSeatId,
  seats,
  editing,
  depth,
}: VsSeatTabsProps) {
  const others = useMemo(
    () => getOtherSeats(seats, heroSeatId),
    [seats, heroSeatId],
  );
  const activeVsSeats = useMemo(
    () => getActiveVsSeats(depth, heroSeatId),
    [depth, heroSeatId],
  );
  const candidates = useMemo(
    () => others.filter((id) => !activeVsSeats.includes(id)),
    [others, activeVsSeats],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (ev: globalThis.MouseEvent) => {
      const node = menuRef.current;
      if (node && ev.target instanceof Node && !node.contains(ev.target)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // 退出编辑模式时收起菜单（避免悬空状态）
  useEffect(() => {
    if (!editing) setMenuOpen(false);
  }, [editing]);

  if (others.length === 0) return null;

  const onClickRfi = () => {
    if (currentVsSeatId === null) return;
    rangeActions.switchVsSeat(null);
  };

  const onClickVs = (vsId: string, e: ReactMouseEvent<HTMLButtonElement>) => {
    if (editing && isVsModifier(e)) {
      rangeActions.removeVsSeat(vsId);
      return;
    }
    if (currentVsSeatId === vsId) return;
    rangeActions.switchVsSeat(vsId);
  };

  const onPickCandidate = (vsId: string) => {
    rangeActions.addVsSeat(vsId);
    setMenuOpen(false);
  };

  const rfiActive = currentVsSeatId === null;

  return (
    <div className={styles.row} role="tablist" aria-label="对战座位">
      <div className={styles.vsTabs}>
        <button
          type="button"
          role="tab"
          aria-selected={rfiActive}
          className={`${styles.vsTab} ${styles.vsRfi} ${rfiActive ? styles.active : ''}`}
          title="默认/开池范围（无对战）"
          onClick={onClickRfi}
        >
          RFI
        </button>
        {activeVsSeats.map((vsId) => {
          const active = vsId === currentVsSeatId;
          const independent = isVsSeatIndependent(depth, heroSeatId, vsId);
          const cells = getCellsForVs(depth, heroSeatId, vsId);
          const marks = countNonFold(cells);
          const tip = `vs ${SEAT_FULL_LABEL[vsId as SeatId] ?? vsId}${
            marks > 0 ? ` · ${marks}/169` : ''
          }${independent ? ' · 已独立' : ''}${
            editing ? ' · ⌘点击 = 删除该对战' : ''
          }`;
          return (
            <button
              key={vsId}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.vsTab} ${active ? styles.active : ''}`}
              title={tip}
              onClick={(e) => onClickVs(vsId, e)}
            >
              <span className={styles.vsTabLabel}>vs {vsId}</span>
              {independent && (
                <span
                  className={styles.indDot}
                  aria-label="已独立"
                  title="已独立编辑（与该 hero 下其它对战不同）"
                />
              )}
            </button>
          );
        })}

        {editing && candidates.length > 0 && (
          <div className={styles.vsAdd} ref={menuRef}>
            <button
              type="button"
              className={`${styles.vsTab} ${styles.vsAddBtn}`}
              title="添加对战座位"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              +
            </button>
            {menuOpen && (
              <div className={styles.vsMenu} role="menu">
                <div className={styles.vsMenuTitle}>添加对战座位</div>
                <div className={styles.vsMenuGrid}>
                  {candidates.map((vsId) => (
                    <button
                      key={vsId}
                      type="button"
                      role="menuitem"
                      className={styles.vsMenuItem}
                      title={`vs ${SEAT_FULL_LABEL[vsId]}`}
                      onClick={() => onPickCandidate(vsId)}
                    >
                      vs {vsId}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
