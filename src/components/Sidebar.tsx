import { RangeList } from './RangeList';
import { DepthList } from './DepthList';

interface Props {
  open: boolean;
}

export function Sidebar({ open }: Props) {
  return (
    <aside className={`app-sidebar ${open ? 'open' : ''}`}>
      <RangeList />
      <div className="sidebar-divider" />
      <DepthList />
    </aside>
  );
}
