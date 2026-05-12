import { useState } from 'react';
import { ActionToolbar } from './components/ActionToolbar';
import { RangeGrid } from './components/RangeGrid';
import { Sidebar } from './components/Sidebar';
import { Stats } from './components/Stats';
import type { Action } from './lib/colors';

export default function App() {
  const [action, setAction] = useState<Action>('raise');

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar open={false} />
        <main className="app-main">
          <ActionToolbar current={action} onChange={setAction} />
          <RangeGrid currentAction={action} />
          <Stats />
        </main>
      </div>
    </div>
  );
}
