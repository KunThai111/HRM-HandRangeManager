import { useEffect, useRef, useState } from 'react';
import { logout, useAuth } from '@/store/useAuthStore';
import { pullAndMerge, useSyncState } from '@/lib/sync';
import styles from '@/styles/userMenu.module.css';

export function UserMenu() {
  const auth = useAuth();
  const sync = useSyncState();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (auth.status !== 'authenticated' || !auth.user) return null;

  const { name, email, picture } = auth.user;
  const display = name || email;
  const initial = (display || '?').trim().charAt(0).toUpperCase();

  async function handleLogout() {
    setOpen(false);
    await logout();
    // Hard reload guarantees any in-memory range state is dropped along with the session.
    window.location.hash = '#/login';
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${email}\n${syncLabel(sync.status, sync.pendingPush)}`}
      >
        <span className={styles.avatarWrap}>
          {picture ? (
            <img src={picture} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatarFallback}>{initial}</span>
          )}
          <span
            className={styles.syncDot}
            data-status={sync.status}
            data-pending={sync.pendingPush ? '1' : '0'}
            aria-hidden
          />
        </span>
        <span className={styles.name}>{display}</span>
        <span className={styles.caret} aria-hidden>▾</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHeader}>
            <div className={styles.menuName}>{name || '未命名用户'}</div>
            <div className={styles.menuEmail}>{email}</div>
          </div>
          <div className={styles.menuSyncRow}>
            <span className={styles.menuSyncLabel}>云同步</span>
            <span className={styles.menuSyncStatus} data-status={sync.status}>
              {syncLabel(sync.status, sync.pendingPush)}
            </span>
          </div>
          {sync.lastSyncedAt != null && (
            <div className={styles.menuSyncSub}>
              上次同步：{formatRelative(sync.lastSyncedAt)}
            </div>
          )}
          {sync.error && (
            <div className={styles.menuSyncError} title={sync.error}>
              {sync.error}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItemRetry}
            onClick={() => {
              void pullAndMerge();
            }}
            disabled={sync.status === 'syncing'}
          >
            立即同步
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItemDanger}
            onClick={handleLogout}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

function syncLabel(status: string, pending: boolean): string {
  switch (status) {
    case 'syncing':
      return '正在同步…';
    case 'error':
      return '同步失败';
    case 'disabled':
      return '未启用';
    case 'idle':
    default:
      return pending ? '等待同步' : '已同步';
  }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return '刚刚';
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  return new Date(ts).toLocaleTimeString();
}
