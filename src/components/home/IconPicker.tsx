import masterIcon from '@/assets/tournament-icons/master.png';
import zodiacIcon from '@/assets/tournament-icons/zodiac.png';
import styles from '@/styles/home.module.css';

/**
 * 比赛图标库。
 * - id 是稳定标识，落库的就是这个 id；
 * - src 是打包后的图片 URL（Vite 处理）。
 *
 * 设计约定：iconId === '' 表示「不选择图标」，列表 / 表格此时不渲染图标。
 */
export interface TournamentIcon {
  id: string;
  src: string;
  label: string;
}

export const TOURNAMENT_ICONS: TournamentIcon[] = [
  { id: 'master', src: masterIcon, label: 'Master' },
  { id: 'zodiac', src: zodiacIcon, label: 'Zodiac' },
];

/** 默认值：不选择（空 id）。 */
export const DEFAULT_ICON_ID = '';

/** 根据 iconId 取图片 URL；为空或未匹配时返回 undefined（= 不展示）。 */
export function getIconSrc(iconId: string | undefined | null): string | undefined {
  if (!iconId) return undefined;
  return TOURNAMENT_ICONS.find((i) => i.id === iconId)?.src;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function IconPicker({ value, onChange }: Props) {
  return (
    <div className={styles.iconGrid} role="radiogroup" aria-label="比赛图标">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        className={`${styles.iconBtn} ${styles.iconBtnNone} ${
          !value ? styles.iconBtnActive : ''
        }`}
        onClick={() => onChange('')}
        title="不选择图标"
      >
        无
      </button>
      {TOURNAMENT_ICONS.map((icon) => {
        const active = icon.id === value;
        return (
          <button
            key={icon.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`${styles.iconBtn} ${active ? styles.iconBtnActive : ''}`}
            onClick={() => onChange(icon.id)}
            title={icon.label}
          >
            <img src={icon.src} alt={icon.label} className={styles.iconBtnImg} />
          </button>
        );
      })}
    </div>
  );
}
