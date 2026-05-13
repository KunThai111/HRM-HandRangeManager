import { TournamentList } from '@/components/home/TournamentList';
import styles from '@/styles/home.module.css';

export function TournamentsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <TournamentList showCreate={false} showFilter showSort />
      </div>
    </div>
  );
}
