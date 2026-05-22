import { useEffect, useRef, useState } from 'react';
import {
  rangeActions,
  useDraft,
  useRangesSorted,
} from '@/store/useRangeStore';
import { clampSeats, type RangeDoc } from '@/store/storage';
import styles from '@/styles/sidebar.module.css';
import { ConfirmDialog } from './ConfirmDialog';
import { NewRangeDialog } from './NewRangeDialog';

interface ItemMenuProps {
  range: RangeDoc;
  onClose: () => void;
  onRequestDelete: () => void;
}

function ItemMenu({ range, onClose, onRequestDelete }: ItemMenuProps) {
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

  const onRename = () => {
    const v = window.prompt('重命名方案：', range.name);
    onClose();
    if (v === null) return;
    rangeActions.rename(range.id, v);
  };
  const onDup = () => {
    onClose();
    rangeActions.duplicate(range.id);
  };
  const onDel = () => {
    onClose();
    onRequestDelete();
  };

  return (
    <div className="menu-pop" ref={ref} style={{ right: 8, top: 30 }}>
      <button type="button" onClick={onRename}>
        重命名
      </button>
      <button type="button" onClick={onDup}>
        复制（含全部深度）
      </button>
      <button type="button" onClick={onDel} className="danger">
        删除
      </button>
    </div>
  );
}

const COLLAPSE_KEY = 'nlhrange.rangeList.collapsed';

export function RangeList() {
  const { rangeId, name: draftName, seats: draftSeats, dirty } = useDraft();
  const ranges = useRangesSorted();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingRange, setDeletingRange] = useState<RangeDoc | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const onOpen = (id: string) => {
    if (id === rangeId) return;
    if (dirty) {
      const ok = window.confirm('当前方案正在编辑中，切换会丢弃本次编辑的涂色，是否继续？');
      if (!ok) return;
    }
    rangeActions.openRange(id);
  };

  const onNew = () => {
    if (dirty) {
      const ok = window.confirm('当前方案正在编辑中，新建会丢弃本次编辑的涂色，是否继续？');
      if (!ok) return;
    }
    setCreating(true);
  };

  const headerText = collapsed
    ? rangeId
      ? `${draftName || 'Untitled'} · ${clampSeats(draftSeats)} 人`
      : '方案列表'
    : '方案列表';

  return (
    <div
      className={`${styles.section} ${styles.rangeSection} ${collapsed ? styles.collapsed : ''}`}
    >
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? '展开方案列表' : '折叠方案列表'}
        title={collapsed ? '展开方案列表' : '折叠方案列表'}
      >
        <span className={styles.sectionTitle}>
          <span
            className={`${styles.caret} ${collapsed ? styles.caretCollapsed : ''}`}
            aria-hidden
          >
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d="M3 5.5 L8 11 L13 5.5 Z" fill="currentColor" />
            </svg>
          </span>
          <span className={collapsed ? styles.headerActiveName : undefined}>
            {headerText}
            {collapsed && rangeId && dirty ? ' *' : ''}
          </span>
        </span>
      </button>
      {!collapsed && (
        <>
          <ul className={styles.list}>
            {ranges.length === 0 && (
              <li className={styles.empty}>暂无保存的方案，点下面「+ 新建方案」开始</li>
            )}
            {ranges.map((r) => {
              const active = r.id === rangeId;
              return (
                <li
                  key={r.id}
                  className={`${styles.item} ${active ? styles.active : ''}`}
                  onClick={() => onOpen(r.id)}
                >
                  <div className={styles.itemTitle}>
                    <span>{r.name}</span>
                    <span
                      className="more"
                      role="button"
                      aria-label="更多操作"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(menuId === r.id ? null : r.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuId(r.id);
                      }}
                    >
                      ⋯
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span>{clampSeats(r.seats)} 人桌</span>
                  </div>
                  {menuId === r.id && (
                    <ItemMenu
                      range={r}
                      onClose={() => setMenuId(null)}
                      onRequestDelete={() => setDeletingRange(r)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <div className={styles.btnRow}>
            <button type="button" onClick={onNew}>
              + 新建方案
            </button>
          </div>
        </>
      )}
      {creating && (
        <NewRangeDialog
          onCancel={() => setCreating(false)}
          onConfirm={(name, seats) => {
            setCreating(false);
            rangeActions.newRange(name, seats);
          }}
        />
      )}
      {deletingRange && (
        <ConfirmDialog
          title="删除方案"
          danger
          confirmText="删除"
          message={
            <>
              确认删除 <strong>「{deletingRange.name}」</strong>？该方案下所有深度子网格都会一并删除。
              <br />
              此操作不可撤销。
            </>
          }
          onCancel={() => setDeletingRange(null)}
          onConfirm={() => {
            const id = deletingRange.id;
            setDeletingRange(null);
            rangeActions.remove(id);
          }}
        />
      )}
    </div>
  );
}
