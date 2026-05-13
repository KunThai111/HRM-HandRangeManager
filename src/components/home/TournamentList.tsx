import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  displayDate,
  displayTimestamp,
  effectiveBounty,
  formatCurrency,
  totalEarning,
  type Tournament,
} from '@/lib/tournaments';
import {
  tournamentActions,
  useTournaments,
  type TournamentDraft,
} from '@/store/useTournamentStore';
import home from '@/styles/home.module.css';
import { getIconSrc } from './IconPicker';
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

function formatDateLabel(t: Tournament): string {
  const raw = displayDate(t);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
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

  const handleSubmit = (draft: TournamentDraft) => {
    if (dialogState.kind === 'edit') {
      tournamentActions.update(dialogState.id, draft);
    } else if (dialogState.kind === 'create') {
      tournamentActions.add(draft);
    }
    setDialogState({ kind: 'closed' });
  };

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`确定删除「${name}」吗？`)) {
      tournamentActions.remove(id);
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
            <thead>
              <tr>
                <th className={home.iconCell} aria-label="图标" />
                <th>名称</th>
                <th>日期</th>
                <th className={home.tdNumeric}>总人数</th>
                <th className={home.tdNumeric}>每桌</th>
                <th className={home.tdNumeric}>买入</th>
                <th className={home.tdNumeric}>名次</th>
                <th className={home.tdNumeric}>奖金</th>
                <th className={home.tdNumeric}>盈亏</th>
                <th className={home.tdRowActions} aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const earning = totalEarning(t);
                const bounty = effectiveBounty(t);
                const profit = earning - t.buyIn;
                const profitClass =
                  profit > 0
                    ? `${home.profit} ${home.profitPositive}`
                    : profit < 0
                      ? `${home.profit} ${home.profitNegative}`
                      : home.profit;
                const sign = profit >= 0 ? '+' : '-';
                const iconSrc = getIconSrc(t.iconId);
                return (
                  <tr
                    key={t.id}
                    onClick={() => setDialogState({ kind: 'edit', id: t.id })}
                  >
                    <td className={home.iconCell}>
                      {iconSrc && (
                        <img
                          src={iconSrc}
                          alt=""
                          className={`${home.iconCellImg} ${
                            t.iconId === 'zodiac' ? home.iconCellImgZodiac : ''
                          }`}
                        />
                      )}
                    </td>
                    <td>
                      {t.name}
                      {t.hasBounty && <span className={home.bountyTag}>赏金</span>}
                    </td>
                    <td>{formatDateLabel(t)}</td>
                    <td className={home.tdNumeric}>{t.totalPlayers || '-'}</td>
                    <td className={home.tdNumeric}>{t.tablePlayers || '-'}</td>
                    <td className={home.tdNumeric}>
                      {formatCurrency(t.buyIn, t.currency)}
                    </td>
                    <td className={home.tdNumeric}>
                      {t.finalRank ? `#${t.finalRank}` : '-'}
                    </td>
                    <td className={home.tdNumeric}>
                      {formatCurrency(t.prize, t.currency)}
                      {bounty > 0 && (
                        <span className={home.bountyHint}>
                          {' + '}
                          {formatCurrency(bounty, t.currency)}
                        </span>
                      )}
                    </td>
                    <td className={`${home.tdNumeric} ${profitClass}`}>
                      {sign}
                      {formatCurrency(Math.abs(profit), t.currency)}
                    </td>
                    <td className={home.tdRowActions}>
                      <button
                        type="button"
                        className={`danger ${home.rowDelete}`}
                        onClick={(e) => handleDelete(e, t.id, t.name)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {dialogState.kind !== 'closed' && (
        <TournamentDialog
          initial={editing}
          onCancel={() => setDialogState({ kind: 'closed' })}
          onSubmit={handleSubmit}
        />
      )}
    </section>
  );
}
