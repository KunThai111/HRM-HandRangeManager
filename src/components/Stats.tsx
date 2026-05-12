import { useMemo } from 'react';
import { ACTIONS, ACTION_COLOR, ACTION_LABEL, type Action } from '@/lib/colors';
import { TOTAL_CELLS } from '@/lib/hands';
import { getCurrentDepthCells, useDraft } from '@/store/useRangeStore';

export function Stats() {
  const draft = useDraft();
  const cells = getCurrentDepthCells(draft);

  const counts = useMemo(() => {
    const c: Record<Action, number> = { fold: 0, call: 0, raise: 0, mixed: 0 };
    for (const key of Object.keys(cells)) c[cells[key]] += 1;
    c.fold = TOTAL_CELLS - c.call - c.raise - c.mixed;
    return c;
  }, [cells]);

  return (
    <div className="stat-row" aria-label="统计">
      {draft.currentDepthLabel && (
        <span style={{ color: 'var(--text-2)' }}>当前深度: {draft.currentDepthLabel}</span>
      )}
      {ACTIONS.map((a) => {
        const n = counts[a];
        const pct = (n / TOTAL_CELLS) * 100;
        return (
          <span key={a} className="stat-item">
            <span className="action-dot" style={{ background: ACTION_COLOR[a] }} />
            <span className="stat-name">{ACTION_LABEL[a]}</span>
            <span>
              {pct.toFixed(1)}%{' '}
              <span style={{ color: 'var(--text-2)' }}>
                ({n}/{TOTAL_CELLS})
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
