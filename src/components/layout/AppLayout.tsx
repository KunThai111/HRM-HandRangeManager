import { Link, Outlet } from 'react-router-dom';
import styles from '@/styles/appLayout.module.css';

export function AppLayout() {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label="返回首页">
          <img src="/Logo.png" alt="" className={styles.logo} />
          <span className={styles.brandTitle}>HRM</span>
        </Link>
        <div className={styles.headerSpacer} />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
