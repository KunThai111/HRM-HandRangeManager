import { useEffect, useRef, useState } from 'react';
import {
  cellSegments,
  resolveActionOrFold,
  type Action,
  type CustomAction,
} from '@/lib/colors';
import { rangeActions, useCustomActions, useDraft } from '@/store/useRangeStore';
import { CustomActionDialog } from './CustomActionDialog';

interface Props {
  current: Action;
  onChange: (a: Action) => void;
  orientation?: 'horizontal' | 'vertical';
}

interface CustomMenuProps {
  action: CustomAction;
  onClose: () => void;
  onEdit: () => void;
  isUsing: boolean;
}

function CustomActionMenu({ action, onClose, onEdit, isUsing }: CustomMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const onDel = () => {
    onClose();
    const msg = isUsing
      ? `确认删除「${action.label}」？当前作用域内所有引用此按钮的格子会被清除。`
      : `确认删除「${action.label}」？`;
    const ok = window.confirm(msg);
    if (!ok) return;
    rangeActions.removeCustomAction(action.id);
  };

  return (
    <div className="menu-pop" ref={ref} style={{ right: 4, top: 28, minWidth: 140 }}>
      <button type="button" onClick={onEdit}>
        编辑名称 / 颜色
      </button>
      <button type="button" onClick={onDel} className="danger">
        删除
      </button>
    </div>
  );
}

export function ActionToolbar({ current, onChange, orientation = 'horizontal' }: Props) {
  const draft = useDraft();
  const customActions = useCustomActions();
  const isVertical = orientation === 'vertical';
  const className = `toolbar ${isVertical ? 'toolbar-vertical' : ''}`.trim();
  const editing = draft.editing;
  const hasRange = !!draft.rangeId;

  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingAction, setEditingAction] = useState<CustomAction | null>(null);
  const [creating, setCreating] = useState(false);

  const usedIds = useUsedActionIds(draft.depths);

  return (
    <>
      <div className={className}>
        <div className="group" role="radiogroup" aria-label="动作">
          {customActions.length === 0 ? (
            <div className="action-empty">
              {editing
                ? '点击下方「+ 添加按钮」创建第一个动作'
                : hasRange
                  ? '尚未添加任何动作按钮，进入编辑模式后可添加'
                  : '先选择或新建一个范围'}
            </div>
          ) : (
            customActions.map((custom) => {
              const id = custom.id;
              const resolved = resolveActionOrFold(id, customActions);
              const active = id === current;
              const showMore = editing;
              return (
                <div key={id} className={`action-pill-wrap ${showMore ? 'has-more' : ''}`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`action-pill ${active ? 'active' : ''}`}
                    style={
                      active
                        ? {
                            background: resolved.color,
                            color: resolved.textColor,
                          }
                        : undefined
                    }
                    title={
                      editing
                        ? '点击选择该动作进行涂色'
                        : active
                          ? '再次点击取消筛选，显示全部范围'
                          : '点击只高亮该动作的范围，其余置灰'
                    }
                    onClick={() => {
                      // 编辑模式：作为画笔；非编辑模式：作为筛选 toggle，再次点击取消选中
                      if (!editing && active) onChange('');
                      else onChange(id);
                    }}
                  >
                    <span className="action-dot" style={{ background: resolved.color }} />
                    {resolved.label}
                  </button>
                  {showMore && (
                    <button
                      type="button"
                      className="action-more"
                      aria-label="更多操作"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(menuId === id ? null : id);
                      }}
                    >
                      ⋯
                    </button>
                  )}
                  {showMore && menuId === id && (
                    <CustomActionMenu
                      action={custom}
                      onClose={() => setMenuId(null)}
                      onEdit={() => {
                        setMenuId(null);
                        setEditingAction(custom);
                      }}
                      isUsing={usedIds.has(id)}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
        {editing && hasRange && (
          <div className="group">
            <button
              type="button"
              className="add-action-btn"
              onClick={() => setCreating(true)}
              title="新增一个自定义动作按钮"
            >
              + 添加按钮
            </button>
          </div>
        )}
      </div>

      {creating && (
        <CustomActionDialog
          existingLabels={customActions.map((c) => c.label)}
          onCancel={() => setCreating(false)}
          onConfirm={(label, color) => {
            const id = rangeActions.addCustomAction(label, color);
            setCreating(false);
            if (id) onChange(id);
          }}
        />
      )}

      {editingAction && (
        <CustomActionDialog
          initial={editingAction}
          existingLabels={customActions
            .filter((c) => c.id !== editingAction.id)
            .map((c) => c.label)}
          onCancel={() => setEditingAction(null)}
          onConfirm={(label, color) => {
            rangeActions.updateCustomAction(editingAction.id, { label, color });
            setEditingAction(null);
          }}
        />
      )}
    </>
  );
}

/** 收集 draft 中所有 cells 引用过的 action id（用于「删除前是否会丢数据」提示）。 */
function useUsedActionIds(depths: ReturnType<typeof useDraft>['depths']): Set<string> {
  const ids = new Set<string>();
  const collect = (v: Action) => {
    for (const s of cellSegments(v)) ids.add(s.id);
  };
  for (const d of depths) {
    for (const v of Object.values(d.sharedCells)) collect(v);
    for (const o of Object.values(d.seatOverrides)) {
      for (const v of Object.values(o.cells)) collect(v);
    }
  }
  return ids;
}
