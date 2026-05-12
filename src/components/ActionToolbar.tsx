import { ACTIONS, ACTION_COLOR, ACTION_LABEL, type Action } from '@/lib/colors';
import { rangeActions } from '@/store/useRangeStore';

interface Props {
  current: Action;
  onChange: (a: Action) => void;
}

export function ActionToolbar({ current, onChange }: Props) {
  return (
    <div className="toolbar">
      <div className="group" role="radiogroup" aria-label="动作">
        {ACTIONS.map((a) => {
          const active = a === current;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={active}
              className={`action-pill ${active ? 'active' : ''}`}
              style={
                active
                  ? { background: ACTION_COLOR[a], color: a === 'mixed' ? '#1f1f1f' : '#fff' }
                  : undefined
              }
              onClick={() => onChange(a)}
            >
              <span className="action-dot" style={{ background: ACTION_COLOR[a] }} />
              {ACTION_LABEL[a]}
            </button>
          );
        })}
      </div>
      <div className="divider" />
      <div className="group">
        <button type="button" onClick={() => rangeActions.clearAll()}>
          全部清空
        </button>
        <button type="button" onClick={() => rangeActions.fillAll('raise')}>
          全部 Raise
        </button>
        <button type="button" onClick={() => rangeActions.fillAll('call')}>
          全部 Call
        </button>
      </div>
    </div>
  );
}
