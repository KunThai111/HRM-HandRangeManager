import { useEffect } from 'react';
import {
  currencyMeta,
  displayDate,
  effectiveBounty,
  formatCurrency,
  formatPercent,
  totalEarning,
  type Tournament,
} from '@/lib/tournaments';
import dialog from '@/styles/dialog.module.css';
import home from '@/styles/home.module.css';
import { getIconSrc } from './IconPicker';

interface Props {
  tournament: Tournament;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ICON_TAG_INFO: Record<string, { label: string; className: string }> = {
  master: { label: '大师赛', className: home.iconTagMaster },
  zodiac: { label: '生肖赛', className: home.iconTagZodiac },
};

function formatDateTime(t: Tournament): string {
  const raw = displayDate(t);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TournamentDetailDialog({
  tournament: t,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const iconSrc = getIconSrc(t.iconId);
  const iconTag = ICON_TAG_INFO[t.iconId];
  const earning = totalEarning(t);
  const profit = earning - t.buyIn;
  const roi = t.buyIn > 0 ? profit / t.buyIn : 0;
  const sign = profit >= 0 ? '+' : '-';
  const profitToneClass =
    profit > 0
      ? home.detailProfitPositive
      : profit < 0
        ? home.detailProfitNegative
        : '';
  const bounty = effectiveBounty(t);

  return (
    <div className={dialog.backdrop} onClick={onClose}>
      <div
        className={`${dialog.dialog} ${home.detailDialog}`}
        role="dialog"
        aria-label="比赛详情"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={home.detailClose}
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>

        <div className={home.detailHero}>
          {iconSrc && (
            <img src={iconSrc} alt="" className={home.detailHeroIcon} />
          )}
          <div className={home.detailHeroBody}>
            <div className={home.detailHeroName}>{t.name}</div>
            {(iconTag || t.hasBounty) && (
              <div className={home.detailHeroTags}>
                {iconTag && (
                  <span className={iconTag.className}>{iconTag.label}</span>
                )}
                {t.hasBounty && <span className={home.bountyTag}>赏金</span>}
              </div>
            )}
            <div className={home.detailHeroDate}>{formatDateTime(t)}</div>
          </div>
        </div>

        <div className={`${home.detailProfitCard} ${profitToneClass}`}>
          <div className={home.detailProfitLabel}>本场盈亏</div>
          <div className={home.detailProfitValue}>
            {sign}
            {formatCurrency(Math.abs(profit), t.currency)}
          </div>
          <div className={home.detailProfitMeta}>
            ROI {profit >= 0 ? '+' : ''}
            {formatPercent(roi)}
          </div>
        </div>

        <div className={home.detailGrid}>
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>买入</div>
            <div className={home.detailItemValue}>
              {formatCurrency(t.buyIn, t.currency)}
            </div>
          </div>
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>奖金</div>
            <div className={home.detailItemValue}>
              {formatCurrency(t.prize, t.currency)}
            </div>
          </div>
          {t.hasBounty && (
            <div className={home.detailItem}>
              <div className={home.detailItemLabel}>赏金</div>
              <div className={home.detailItemValue}>
                {formatCurrency(bounty, t.currency)}
              </div>
            </div>
          )}
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>名次</div>
            <div className={home.detailItemValue}>
              {t.finalRank ? `第 ${t.finalRank} 名` : '—'}
            </div>
          </div>
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>总人数</div>
            <div className={home.detailItemValue}>{t.totalPlayers || '—'}</div>
          </div>
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>每桌人数</div>
            <div className={home.detailItemValue}>{t.tablePlayers || '—'}</div>
          </div>
          <div className={home.detailItem}>
            <div className={home.detailItemLabel}>币种</div>
            <div className={home.detailItemValue}>
              {currencyMeta(t.currency).label}
            </div>
          </div>
        </div>

        {t.note && (
          <div className={home.detailNote}>
            <div className={home.detailNoteLabel}>备注</div>
            <div className={home.detailNoteText}>{t.note}</div>
          </div>
        )}

        <div className={home.detailFooter}>
          <button
            type="button"
            className={`danger ${home.detailFooterBtn}`}
            onClick={onDelete}
          >
            删除
          </button>
          <button
            type="button"
            className={`primary ${home.detailFooterBtn}`}
            onClick={onEdit}
          >
            编辑
          </button>
        </div>
      </div>
    </div>
  );
}
