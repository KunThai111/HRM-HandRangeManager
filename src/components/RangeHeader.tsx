import { rangeActions, useDraft } from '@/store/useRangeStore';

interface Props {
  onToggleSidebar?: () => void;
}

export function RangeHeader({ onToggleSidebar }: Props) {
  const { name, dirty, rangeId, currentDepthLabel } = useDraft();
  const noRange = !rangeId;

  const onSave = () => {
    if (noRange) return;
    rangeActions.save();
  };
  const onSaveAs = () => {
    if (noRange) return;
    const v = window.prompt('另存为新范围（连同所有深度子网格一起复制）：', `${name} (copy)`);
    if (v === null) return;
    rangeActions.saveAs(v);
  };
  const onDelete = () => {
    if (!rangeId) return;
    const ok = window.confirm(`确认删除范围「${name}」（含所有深度）？此操作不可撤销。`);
    if (!ok) return;
    rangeActions.remove(rangeId);
  };

  return (
    <div className="app-header">
      {onToggleSidebar && (
        <button
          type="button"
          className="ghost mobile-burger"
          onClick={onToggleSidebar}
          aria-label="菜单"
        >
          ☰
        </button>
      )}
      <div style={{ fontWeight: 700, letterSpacing: 0.2 }}>NLH Range</div>
      {currentDepthLabel && (
        <span style={{ color: 'var(--text-2)', fontSize: 12 }}>· {currentDepthLabel}</span>
      )}
      <input
        type="text"
        className="range-name-input"
        value={name}
        placeholder={noRange ? '（未选中范围）' : '范围名称（如 BTN RFI）'}
        disabled={noRange}
        onChange={(e) => rangeActions.setName(e.target.value)}
        spellCheck={false}
      />
      {dirty && <span className="dirty-dot" title="有未保存的改动">●</span>}
      <div style={{ flex: 1 }} />
      <button className="primary" type="button" onClick={onSave} disabled={noRange || !dirty}>
        保存
      </button>
      <button type="button" onClick={onSaveAs} disabled={noRange}>
        另存为
      </button>
      <button type="button" className="danger" onClick={onDelete} disabled={noRange}>
        删除
      </button>
    </div>
  );
}
