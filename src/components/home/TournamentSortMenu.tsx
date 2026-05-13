import { useEffect, useRef, useState } from 'react';
import home from '@/styles/home.module.css';

/**
 * 比赛列表的排序状态。
 *
 * 设计：
 * - `timeOrder` 描述「按时间排」的方向；`null` 表示不参与时间排序。
 *   正序 / 倒序在 UI 上虽然用 checkbox 呈现，但语义互斥 —— 点已选中的会取消，
 *   点另一个会切换；目的是让「时间不参与排序」这种状态对用户可达。
 * - `byPrizeDesc` 是独立开关；可以和任意 `timeOrder` 组合勾选。
 * - 实际排序时「奖金降序」为主键、时间为次键。这样：
 *   - 只勾时间 → 纯按时间排
 *   - 只勾奖金 → 纯按奖金降序
 *   - 都勾 → 主奖金次时间，奖金相同时退回时间方向
 */
export type TimeOrder = 'asc' | 'desc' | null;

export interface SortState {
  timeOrder: TimeOrder;
  byPrizeDesc: boolean;
}

export const DEFAULT_SORT: SortState = { timeOrder: 'desc', byPrizeDesc: false };

interface Props {
  value: SortState;
  onChange: (next: SortState) => void;
}

function buildLabel(s: SortState): string {
  const tags: string[] = [];
  if (s.timeOrder === 'asc') tags.push('时间 ↑');
  else if (s.timeOrder === 'desc') tags.push('时间 ↓');
  if (s.byPrizeDesc) tags.push('奖金 ↓');
  if (tags.length === 0) return '排序';
  return `排序 · ${tags.join(' + ')}`;
}

export function TournamentSortMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const setTime = (order: 'asc' | 'desc') => {
    onChange({
      ...value,
      timeOrder: value.timeOrder === order ? null : order,
    });
  };

  const togglePrize = () => {
    onChange({ ...value, byPrizeDesc: !value.byPrizeDesc });
  };

  return (
    <div ref={wrapRef} className={home.sortWrap}>
      <button
        type="button"
        className={`${home.sortBtn} ${open ? home.sortBtnOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{buildLabel(value)}</span>
        <span className={home.sortCaret} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className={home.sortPopover} role="menu">
          <div className={home.sortGroupLabel}>时间</div>
          <label className={home.sortOption}>
            <input
              type="checkbox"
              checked={value.timeOrder === 'asc'}
              onChange={() => setTime('asc')}
            />
            <span>正序（早 → 晚）</span>
          </label>
          <label className={home.sortOption}>
            <input
              type="checkbox"
              checked={value.timeOrder === 'desc'}
              onChange={() => setTime('desc')}
            />
            <span>倒序（晚 → 早）</span>
          </label>

          <div className={home.sortDivider} />

          <div className={home.sortGroupLabel}>奖金</div>
          <label className={home.sortOption}>
            <input
              type="checkbox"
              checked={value.byPrizeDesc}
              onChange={togglePrize}
            />
            <span>降序（高 → 低）</span>
          </label>
        </div>
      )}
    </div>
  );
}
