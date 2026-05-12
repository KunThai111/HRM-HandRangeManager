import { useEffect, useState } from 'react';
import { ActionToolbar } from './components/ActionToolbar';
import { RangeGrid } from './components/RangeGrid';
import { SeatTabs } from './components/SeatTabs';
import { Sidebar } from './components/Sidebar';
import { Stats } from './components/Stats';
import type { Action } from './lib/colors';
import { useCustomActions, useDraft } from './store/useRangeStore';

export default function App() {
  // 空字符串 = 未选中任何动作；此时禁止涂色，需用户先在 ActionToolbar 添加自定义按钮
  const [action, setAction] = useState<Action>('');
  const draft = useDraft();
  const customActions = useCustomActions();

  useEffect(() => {
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

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar open={false} />
        <main className="app-main">
          <SeatTabs />
          <div className="work-area">
            <RangeGrid currentAction={action} />
            <ActionToolbar current={action} onChange={setAction} orientation="vertical" />
          </div>
          <Stats />
        </main>
      </div>
    </div>
  );
}
