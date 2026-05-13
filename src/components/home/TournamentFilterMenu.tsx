import { useEffect, useRef, useState } from 'react';
import home from '@/styles/home.module.css';

/**
 * 比赛列表的时间筛选状态。
 *
 * 设计：
 * - `preset` 表示用户选中的快捷范围；`'custom'` 时由 `customFrom` / `customTo` 决定。
 * - 快捷预设之间互斥；点击快捷选项会清空自定义日期。
 * - 修改自定义日期时自动切换到 `preset: 'custom'`；当 from / to 同时为空时回退到 `'all'`，
 *   避免按钮显示「自定义」但实际无任何过滤的违和状态。
 */
export type FilterPreset = 'all' | '7d' | '30d' | '90d' | 'year' | 'custom';

export interface FilterState {
  preset: FilterPreset;
  /** YYYY-MM-DD，含义为本地时区当天 0 点（含）。 */
  customFrom?: string;
  /** YYYY-MM-DD，含义为本地时区当天 23:59:59.999（含）。 */
  customTo?: string;
}

export const DEFAULT_FILTER: FilterState = { preset: 'all' };

const PRESETS: Array<{ id: Exclude<FilterPreset, 'custom'>; label: string }> = [
  { id: 'all', label: '全部' },
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: '90d', label: '近 90 天' },
  { id: 'year', label: '今年' },
];

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfYear(): number {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 把筛选状态转成时间区间 `[from, to]`（毫秒时间戳，闭区间）。
 * 返回 `null` = 不过滤。
 */
export function filterRange(f: FilterState): { from: number; to: number } | null {
  if (f.preset === 'all') return null;
  const DAY = 86_400_000;
  const todayStart = startOfToday();
  switch (f.preset) {
    case '7d':
      return { from: todayStart - 6 * DAY, to: Number.POSITIVE_INFINITY };
    case '30d':
      return { from: todayStart - 29 * DAY, to: Number.POSITIVE_INFINITY };
    case '90d':
      return { from: todayStart - 89 * DAY, to: Number.POSITIVE_INFINITY };
    case 'year':
      return { from: startOfYear(), to: Number.POSITIVE_INFINITY };
    case 'custom': {
      let from = Number.NEGATIVE_INFINITY;
      let to = Number.POSITIVE_INFINITY;
      if (f.customFrom) {
        const d = new Date(`${f.customFrom}T00:00:00`);
        if (!Number.isNaN(d.getTime())) from = d.getTime();
      }
      if (f.customTo) {
        const d = new Date(`${f.customTo}T23:59:59.999`);
        if (!Number.isNaN(d.getTime())) to = d.getTime();
      }
      if (from === Number.NEGATIVE_INFINITY && to === Number.POSITIVE_INFINITY) {
        return null;
      }
      return { from, to };
    }
  }
}

function buildLabel(f: FilterState): string {
  if (f.preset === 'all') return '筛选';
  const preset = PRESETS.find((p) => p.id === f.preset);
  if (preset) return `筛选 · ${preset.label}`;
  const { customFrom: from, customTo: to } = f;
  if (from && to) return `筛选 · ${from} → ${to}`;
  if (from) return `筛选 · ≥ ${from}`;
  if (to) return `筛选 · ≤ ${to}`;
  return '筛选 · 自定义';
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
}

export function TournamentFilterMenu({ value, onChange }: Props) {
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

  const pickPreset = (id: Exclude<FilterPreset, 'custom'>) => {
    onChange({ preset: id, customFrom: undefined, customTo: undefined });
  };

  const updateCustom = (patch: Partial<Pick<FilterState, 'customFrom' | 'customTo'>>) => {
    const merged: FilterState = {
      preset: 'custom',
      customFrom: value.customFrom,
      customTo: value.customTo,
      ...patch,
    };
    if (!merged.customFrom && !merged.customTo) {
      onChange({ preset: 'all' });
      return;
    }
    onChange(merged);
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
        <div className={`${home.sortPopover} ${home.filterPopover}`} role="menu">
          <div className={home.sortGroupLabel}>快捷范围</div>
          <div className={home.filterChips}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${home.filterChip} ${
                  value.preset === p.id ? home.filterChipActive : ''
                }`}
                onClick={() => pickPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className={home.sortDivider} />

          <div className={home.sortGroupLabel}>自定义范围</div>
          <div className={home.filterCustomRow}>
            <input
              type="date"
              className={home.filterDateInput}
              value={value.customFrom ?? ''}
              max={value.customTo || undefined}
              onChange={(e) => updateCustom({ customFrom: e.target.value || undefined })}
              aria-label="起始日期"
            />
            <span className={home.filterDash} aria-hidden>
              →
            </span>
            <input
              type="date"
              className={home.filterDateInput}
              value={value.customTo ?? ''}
              min={value.customFrom || undefined}
              onChange={(e) => updateCustom({ customTo: e.target.value || undefined })}
              aria-label="结束日期"
            />
          </div>
        </div>
      )}
    </div>
  );
}
