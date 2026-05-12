import { useMemo } from 'react';
import { ACTIONS, ACTION_COLOR, ACTION_LABEL, type Action } from '@/lib/colors';
import { TOTAL_CELLS } from '@/lib/hands';
import { getCurrentDepthCells, rangeActions, useDraft } from '@/store/useRangeStore';

export function Stats() {
  const draft = useDraft();
  const cells = getCurrentDepthCells(draft);
  const canEdit = !!draft.rangeId && !!draft.currentDepthLabel;

  const counts = useMemo(() => {
    const c: Record<Action, number> = { fold: 0, call: 0, raise: 0, mixed: 0 };
    for (const key of Object.keys(cells)) c[cells[key]] += 1;
    c.fold = TOTAL_CELLS - c.call - c.raise - c.mixed;
    return c;
  }, [cells]);

  return (
    <div className="stat-row" aria-label="统计">
      <div className="edit-toggle" role="group" aria-label="范围表编辑模式">
        {draft.editing ? (
          <>
            <button
              type="button"
              className="primary edit-btn"
              onClick={() => rangeActions.confirmEdit()}
              title="退出编辑模式，保留涂色（仍需在顶部点保存才会落盘）"
            >
              ✓ 确定
            </button>
            <button
              type="button"
              className="edit-btn"
              onClick={() => rangeActions.cancelEdit()}
              title="放弃本次编辑，恢复到进入编辑前的状态"
            >
              ✕ 取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="edit-btn"
            disabled={!canEdit}
            onClick={() => rangeActions.beginEdit()}
            title={canEdit ? '进入编辑模式后才能涂色' : '先选择或新建一个范围'}
          >
            ✎ 编辑
          </button>
        )}
      </div>
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
