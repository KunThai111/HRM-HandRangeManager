import { useMemo } from 'react';
import { resolveActionOrFold } from '@/lib/colors';
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

  const { counts, legacyIds, foldCount } = useMemo(() => {
    const c: Record<string, number> = {};
    for (const ca of customActions) c[ca.id] = 0;
    let nonFold = 0;
    const legacy = new Set<string>();
    for (const key of Object.keys(cells)) {
      const id = cells[key];
      c[id] = (c[id] ?? 0) + 1;
      nonFold += 1;
      if (!customActions.some((ca) => ca.id === id)) legacy.add(id);
    }
    return {
      counts: c,
      legacyIds: Array.from(legacy),
      foldCount: TOTAL_CELLS - nonFold,
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

      <span className="stat-item">
        <span
          className="action-dot"
          style={{ background: '#ffffff', border: '1px solid var(--border)' }}
        />
        <span className="stat-name">未标记</span>
        <span>
          {((foldCount / TOTAL_CELLS) * 100).toFixed(1)}%{' '}
          <span style={{ color: 'var(--text-2)' }}>
            ({foldCount}/{TOTAL_CELLS})
          </span>
        </span>
      </span>

      {customActions.map((ca) => {
        const n = counts[ca.id] ?? 0;
        const pct = (n / TOTAL_CELLS) * 100;
        return (
          <span key={ca.id} className="stat-item">
            <span className="action-dot" style={{ background: ca.color }} />
            <span className="stat-name">{ca.label}</span>
            <span>
              {pct.toFixed(1)}%{' '}
              <span style={{ color: 'var(--text-2)' }}>
                ({n}/{TOTAL_CELLS})
              </span>
            </span>
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
          <span key={id} className="stat-item" title="未注册的动作（来自旧数据）">
            <span className="action-dot" style={{ background: resolved.color }} />
            <span className="stat-name" style={{ color: 'var(--text-2)' }}>
              {resolved.label}
            </span>
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
