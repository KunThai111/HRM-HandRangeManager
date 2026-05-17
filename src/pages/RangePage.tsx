import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionToolbar } from '@/components/ActionToolbar';
import { RangeDetail } from '@/components/RangeDetail';
import { RangeGrid } from '@/components/RangeGrid';
import { SeatTabs } from '@/components/SeatTabs';
import { Sidebar } from '@/components/Sidebar';
import { Stats } from '@/components/Stats';
import type { Action } from '@/lib/colors';
import { useCustomActions, useDraft } from '@/store/useRangeStore';

export function RangePage() {
  // 空字符串 = 未选中任何动作；此时禁止涂色，需用户先在 ActionToolbar 添加自定义按钮
  const [action, setAction] = useState<Action>('');
  /**
   * 当前被放大查看的 hand（非编辑模式：点击有色格子；编辑模式：Shift+点击任意格子）。
   * 提升到 App 层是为了让 RangeDetail 也能读到，并据此显示/隐藏。
   */
  const [zoomedHand, setZoomedHand] = useState<string | null>(null);
  /**
   * 是否处于「备注编辑」子模式。仅当 editing && Shift+click 触发时为 true。
   * 决定 RangeDetail 中是否显示可编辑 textarea。
   */
  const [editingNote, setEditingNote] = useState(false);
  const draft = useDraft();
  const customActions = useCustomActions();
  const wasEditingRef = useRef(draft.editing);

  useEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = draft.editing;

    // 刚从编辑模式退出（确定 / 取消）：清空行为按钮选中态
    if (wasEditing && !draft.editing) {
      if (action !== '') setAction('');
      return;
    }

    // 当前 action 仍是合法 custom id → 不动
    if (action !== '' && customActions.some((c) => c.id === action)) return;
    if (draft.editing) {
      // 编辑模式必须选一个动作才能涂色，自动落到第一个 custom
      if (customActions.length > 0) setAction(customActions[0].id);
      else if (action !== '') setAction('');
    } else {
      // 非编辑模式：'' = 无筛选是合法状态；若 action 指向已删除的 id 则清掉
      if (action !== '') setAction('');
    }
  }, [draft.rangeId, draft.editing, customActions, action]);

  // 切换 range / 退出编辑 时，自动清掉放大态
  useEffect(() => {
    setZoomedHand(null);
    setEditingNote(false);
  }, [draft.rangeId]);

  useEffect(() => {
    // 退出编辑模式时关掉备注编辑子状态（zoom 自身可在非编辑下保留供查看）
    if (!draft.editing) setEditingNote(false);
  }, [draft.editing]);

  // 子组件回调：要求设定 zoom 与是否进入备注编辑模式（editingNote 仅在编辑模式下生效）
  const onZoomChange = useCallback(
    (hand: string | null, opts?: { editNote?: boolean }) => {
      setZoomedHand(hand);
      if (hand === null) setEditingNote(false);
      else setEditingNote(!!opts?.editNote);
    },
    [],
  );

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar open={false} />
        <main className="app-main">
          <SeatTabs />
          <div className="work-area">
            <RangeGrid
              currentAction={action}
              zoomedHand={zoomedHand}
              onZoomChange={onZoomChange}
            />
            <div className="work-right">
              <ActionToolbar
                current={action}
                onChange={setAction}
                orientation="vertical"
              />
              {zoomedHand && (
                <RangeDetail
                  hand={zoomedHand}
                  editingNote={editingNote}
                  onClose={() => onZoomChange(null)}
                />
              )}
            </div>
          </div>
          <Stats />
        </main>
      </div>
    </div>
  );
}
