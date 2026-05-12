import { useEffect, useRef, useState } from 'react';
import {
  rangeActions,
  useDraft,
  useRangesSorted,
} from '@/store/useRangeStore';
import type { RangeDoc } from '@/store/storage';
import styles from '@/styles/sidebar.module.css';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ItemMenuProps {
  range: RangeDoc;
  onClose: () => void;
}

function ItemMenu({ range, onClose }: ItemMenuProps) {
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
    const ok = window.confirm(`确认删除「${range.name}」？该方案下所有深度子网格都会一并删除。`);
    if (!ok) return;
    rangeActions.remove(range.id);
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
  const { rangeId, name: draftName, dirty } = useDraft();
  const ranges = useRangesSorted();
  const [menuId, setMenuId] = useState<string | null>(null);
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
      const ok = window.confirm('当前方案有未保存的改动，切换会丢弃改动，是否继续？');
      if (!ok) return;
    }
    rangeActions.openRange(id);
  };

  const onNew = () => {
    if (dirty) {
      const ok = window.confirm('当前方案有未保存的改动，新建会丢弃改动，是否继续？');
      if (!ok) return;
    }
    const v = window.prompt('新建方案名称：', 'Untitled');
    if (v === null) return;
    rangeActions.newRange(v);
  };

  const headerText = collapsed
    ? rangeId
      ? draftName || 'Untitled'
      : '方案列表'
    : '方案列表';

  return (
    <div className={`${styles.section} ${collapsed ? styles.collapsed : ''}`}>
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
                    <span>{r.depths.length}d</span>
                    <span>{formatTime(r.updatedAt)}</span>
                  </div>
                  {menuId === r.id && <ItemMenu range={r} onClose={() => setMenuId(null)} />}
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
    </div>
  );
}
