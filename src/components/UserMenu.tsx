import { useEffect, useRef, useState } from 'react';
import { logout, useAuth } from '@/store/useAuthStore';
import styles from '@/styles/userMenu.module.css';

export function UserMenu() {
  const auth = useAuth();
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
        title={email}
      >
        {picture ? (
          <img src={picture} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarFallback}>{initial}</span>
        )}
        <span className={styles.name}>{display}</span>
        <span className={styles.caret} aria-hidden>▾</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHeader}>
            <div className={styles.menuName}>{name || '未命名用户'}</div>
            <div className={styles.menuEmail}>{email}</div>
          </div>
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
