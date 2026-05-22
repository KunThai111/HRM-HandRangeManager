import { useMemo } from 'react';
import { cellSegments, resolveActionOrFold } from '@/lib/colors';
import { TOTAL_CELLS } from '@/lib/hands';
import {
  getCurrentCells,
  rangeActions,
  useCustomActions,
  useDraft,
} from '@/store/useRangeStore';

export function Stats() {
  const draft = useDraft();
  const customActions = useCustomActions();
  const cells = getCurrentCells(draft);
  const canEdit =
    !!draft.rangeId && !!draft.currentDepthLabel && !!draft.currentSeatId;

  // 加权统计：每段贡献 weight/100 格；50% A + 40% B 的 1 格 → A 0.5 + B 0.4。
  const { counts, legacyIds } = useMemo(() => {
    const c: Record<string, number> = {};
    for (const ca of customActions) c[ca.id] = 0;
    const legacy = new Set<string>();
    for (const key of Object.keys(cells)) {
      const segs = cellSegments(cells[key]);
      for (const s of segs) {
        c[s.id] = (c[s.id] ?? 0) + s.weight / 100;
        if (!customActions.some((ca) => ca.id === s.id)) legacy.add(s.id);
      }
    }
    return {
      counts: c,
      legacyIds: Array.from(legacy),
    };
  }, [cells, customActions]);

  return (
    <div className="stat-row" aria-label="统计">
      <div className="edit-toggle" role="group" aria-label="范围表编辑模式">
        {draft.editing ? (
          <>
            <button
              type="button"
              className="primary edit-btn"
              onClick={() => rangeActions.confirmEdit()}
              title="退出编辑模式并保存涂色"
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

      {customActions.map((ca) => {
        const n = counts[ca.id] ?? 0;
        const pct = (n / TOTAL_CELLS) * 100;
        return (
          <span key={ca.id} className="stat-item" title={ca.label}>
            <span className="action-dot" style={{ background: ca.color }} />
            <span>{pct.toFixed(1)}%</span>
          </span>
        );
      })}

      {/* 兜底：旧数据中残留的内置 action（如 raise/call/mixed），用户已删除按钮但 cells 还在。
          只在确实有数据时才显示，避免空 0%。 */}
      {legacyIds.map((id) => {
        const n = counts[id] ?? 0;
        if (n === 0) return null;
        const resolved = resolveActionOrFold(id, customActions);
        const pct = (n / TOTAL_CELLS) * 100;
        return (
          <span
            key={id}
            className="stat-item"
            title={`${resolved.label}（未注册的动作，来自旧数据）`}
          >
            <span className="action-dot" style={{ background: resolved.color }} />
            <span style={{ color: 'var(--text-2)' }}>{pct.toFixed(1)}%</span>
          </span>
        );
      })}
    </div>
  );
}
