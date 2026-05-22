import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  displayDate,
  displayTimestamp,
  formatCurrency,
  formatMoney,
  totalEarning,
  type Tournament,
} from '@/lib/tournaments';
import {
  tournamentActions,
  useTournaments,
  type TournamentDraft,
} from '@/store/useTournamentStore';
import home from '@/styles/home.module.css';
import { TournamentDetailDialog } from './TournamentDetailDialog';
import { TournamentDialog } from './TournamentDialog';
import {
  DEFAULT_FILTER,
  TournamentFilterMenu,
  filterRange,
  type FilterState,
} from './TournamentFilterMenu';
import {
  DEFAULT_SORT,
  TournamentSortMenu,
  type SortState,
} from './TournamentSortMenu';

interface IconTagInfo {
  label: string;
  className: string;
}

const ICON_TAG_INFO: Record<string, IconTagInfo> = {
  master: { label: '大师赛', className: home.iconTagMaster },
  zodiac: { label: '生肖赛', className: home.iconTagZodiac },
};

interface DateParts {
  main: string;
  year: string;
}

function formatDateParts(t: Tournament): DateParts {
  const raw = displayDate(t);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { main: raw, year: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const currentYear = new Date().getFullYear();
  return {
    main: `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    year: year === currentYear ? '' : String(year),
  };
}

type IconProps = React.SVGProps<SVGSVGElement>;

function PeopleIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19v-1A3.5 3.5 0 0 1 7 14.5h4A3.5 3.5 0 0 1 14.5 18v1" />
      <path d="M15 4.7a3.2 3.2 0 0 1 0 6.1" />
      <path d="M16.5 14.6A3.5 3.5 0 0 1 19 18v1" />
    </svg>
  );
}

function CoinIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="currentColor"
        stroke="none"
      >
        B
      </text>
    </svg>
  );
}

function ChairIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 4h10v9H7z" />
      <path d="M5.5 13h13" />
      <path d="M8 13v7" />
      <path d="M16 13v7" />
    </svg>
  );
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; id: string };

interface TournamentListProps {
  /** 限制显示条数，未设置 = 显示全部 */
  limit?: number;
  /** 是否显示「+ 新增比赛」按钮，默认 true */
  showCreate?: boolean;
  /** 是否显示「全部比赛 →」按钮，默认 false */
  showViewAll?: boolean;
  /** 是否显示排序按钮（仅在「全部比赛」页有意义），默认 false */
  showSort?: boolean;
  /** 是否显示时间筛选按钮，默认 false */
  showFilter?: boolean;
}

export function TournamentList({
  limit,
  showCreate = true,
  showViewAll = false,
  showSort = false,
  showFilter = false,
}: TournamentListProps = {}) {
  const list = useTournaments();
  const [dialogState, setDialogState] = useState<DialogState>({ kind: 'closed' });
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  const filtered = useMemo(() => {
    const range = filterRange(filter);
    if (!range) return list;
    return list.filter((t) => {
      const ts = displayTimestamp(t);
      return ts >= range.from && ts <= range.to;
    });
  }, [list, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sort.byPrizeDesc) {
        const diff = totalEarning(b) - totalEarning(a);
        if (diff !== 0) return diff;
      }
      if (sort.timeOrder) {
        const ta = displayTimestamp(a);
        const tb = displayTimestamp(b);
        return sort.timeOrder === 'desc' ? tb - ta : ta - tb;
      }
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  const visible = useMemo(
    () => (typeof limit === 'number' ? sorted.slice(0, limit) : sorted),
    [sorted, limit],
  );

  const editing =
    dialogState.kind === 'edit'
      ? list.find((t) => t.id === dialogState.id)
      : undefined;

  const detailing =
    dialogState.kind === 'detail'
      ? list.find((t) => t.id === dialogState.id)
      : undefined;

  const handleSubmit = (draft: TournamentDraft) => {
    if (dialogState.kind === 'edit') {
      tournamentActions.update(dialogState.id, draft);
    } else if (dialogState.kind === 'create') {
      tournamentActions.add(draft);
    }
    setDialogState({ kind: 'closed' });
  };

  const handleDetailDelete = (id: string, name: string) => {
    if (confirm(`确定删除「${name}」吗？`)) {
      tournamentActions.remove(id);
      setDialogState({ kind: 'closed' });
    }
  };

  return (
    <section>
      <div className={home.sectionHeader}>
        <div className={home.sectionActions}>
          {showFilter && (
            <TournamentFilterMenu value={filter} onChange={setFilter} />
          )}
          {showSort && <TournamentSortMenu value={sort} onChange={setSort} />}
          {showCreate && (
            <button
              type="button"
              className="primary"
              onClick={() => setDialogState({ kind: 'create' })}
            >
              + 新增比赛
            </button>
          )}
          {showViewAll && (
            <Link to="/tournaments" className={home.viewAllBtn}>
              更多比赛 →
            </Link>
          )}
        </div>
      </div>

      <div className={home.tableWrap} style={{ marginTop: 12 }}>
        {visible.length === 0 ? (
          <div className={home.empty}>
            {list.length === 0
              ? '暂无比赛记录，点击「新增比赛」开始'
              : '当前筛选条件下没有比赛'}
          </div>
        ) : (
          <table className={home.table}>
            <colgroup>
              <col className={home.colDate} />
              <col className={home.colInfo} />
              <col className={home.colProfit} />
            </colgroup>
            <tbody>
              {visible.map((t) => {
                const earning = totalEarning(t);
                const profit = earning - t.buyIn;
                const hasProfit = profit !== 0;
                const profitClass =
                  profit > 0
                    ? `${home.profit} ${home.profitPositive}`
                    : profit < 0
                      ? `${home.profit} ${home.profitNegative}`
                      : home.profit;
                const sign = profit > 0 ? '+' : '-';
                const iconTag = ICON_TAG_INFO[t.iconId];
                const { main: dateMain, year: dateYear } = formatDateParts(t);
                return (
                  <tr
                    key={t.id}
                    onClick={() => setDialogState({ kind: 'detail', id: t.id })}
                  >
                    <td className={home.dateCell}>
                      <div className={home.dateMain}>{dateMain}</div>
                      {dateYear && (
                        <div className={home.dateYear}>{dateYear}</div>
                      )}
                    </td>
                    <td className={home.infoCell}>
                      <div className={home.infoRow}>
                        <div className={home.infoMain}>
                          <div className={home.infoTitle}>
                            <span className={home.infoName}>{t.name}</span>
                            {iconTag && (
                              <span className={iconTag.className}>
                                {iconTag.label}
                              </span>
                            )}
                            {t.hasBounty && (
                              <span className={home.bountyTag}>赏金</span>
                            )}
                          </div>
                          <div className={home.infoMeta}>
                            <span className={home.metaItem}>
                              <PeopleIcon className={home.metaIcon} />
                              {t.totalPlayers || '-'}
                            </span>
                            <span className={home.metaItem}>
                              <CoinIcon className={home.metaIcon} />
                              {t.currency === 'USD'
                                ? formatMoney(t.buyIn)
                                : formatCurrency(t.buyIn, t.currency)}
                            </span>
                            <span className={home.metaItem}>
                              <ChairIcon className={home.metaIcon} />
                              {t.tablePlayers || '-'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={`${home.tdNumeric} ${home.profitCell} ${profitClass}`}>
                      {hasProfit && (
                        <>
                          {sign}
                          {formatCurrency(Math.abs(profit), t.currency)}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailing && (
        <TournamentDetailDialog
          tournament={detailing}
          onClose={() => setDialogState({ kind: 'closed' })}
          onEdit={() =>
            setDialogState({ kind: 'edit', id: detailing.id })
          }
          onDelete={() => handleDetailDelete(detailing.id, detailing.name)}
        />
      )}

      {(dialogState.kind === 'create' || dialogState.kind === 'edit') && (
        <TournamentDialog
          initial={editing}
          onCancel={() => setDialogState({ kind: 'closed' })}
          onSubmit={handleSubmit}
        />
      )}
    </section>
  );
}
