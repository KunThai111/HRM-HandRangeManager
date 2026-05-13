import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyMeta,
  type Currency,
  type Tournament,
} from '@/lib/tournaments';
import type { TournamentDraft } from '@/store/useTournamentStore';
import dialog from '@/styles/dialog.module.css';
import home from '@/styles/home.module.css';
import { IconPicker } from './IconPicker';

interface Props {
  /** 传入 = 编辑现有；不传 = 新建。 */
  initial?: Tournament;
  onCancel: () => void;
  onSubmit: (draft: TournamentDraft) => void;
}

interface FormState {
  name: string;
  iconId: string;
  currency: Currency;
  totalPlayers: string;
  tablePlayers: string;
  buyIn: string;
  finalRank: string;
  prize: string;
  hasBounty: boolean;
  bounty: string;
  /** datetime-local 输入控件值；空 = 使用提交时间。 */
  date: string;
  note: string;
}

function toLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // datetime-local 的 value 需要本地时区，不能直接 toISOString
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function buildInitial(initial?: Tournament): FormState {
  if (!initial) {
    return {
      name: '',
      iconId: '',
      currency: DEFAULT_CURRENCY,
      totalPlayers: '',
      tablePlayers: '',
      buyIn: '',
      finalRank: '',
      prize: '',
      hasBounty: false,
      bounty: '',
      date: '',
      note: '',
    };
  }
  return {
    name: initial.name,
    iconId: initial.iconId ?? '',
    currency: initial.currency ?? DEFAULT_CURRENCY,
    totalPlayers: String(initial.totalPlayers ?? 0),
    tablePlayers: String(initial.tablePlayers ?? 0),
    buyIn: String(initial.buyIn ?? 0),
    finalRank: String(initial.finalRank ?? 0),
    prize: String(initial.prize ?? 0),
    hasBounty: Boolean(initial.hasBounty),
    bounty: initial.hasBounty ? String(initial.bounty ?? 0) : '',
    date: toLocalInput(initial.date),
    note: initial.note ?? '',
  };
}

function parseNumber(s: string): number {
  if (!s.trim()) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function TournamentDialog({ initial, onCancel, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitial(initial));
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const isEdit = Boolean(initial);
  const title = useMemo(() => (isEdit ? '编辑比赛' : '新增比赛'), [isEdit]);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((s) => ({ ...s, [key]: value }));
    setErrMsg(null);
  };

  const submit = () => {
    const name = form.name.trim();
    if (!name) {
      setErrMsg('比赛名称不能为空');
      return;
    }
    const draft: TournamentDraft = {
      name,
      iconId: form.iconId,
      currency: form.currency,
      totalPlayers: parseNumber(form.totalPlayers),
      tablePlayers: parseNumber(form.tablePlayers),
      buyIn: parseNumber(form.buyIn),
      finalRank: parseNumber(form.finalRank),
      prize: parseNumber(form.prize),
      hasBounty: form.hasBounty,
      bounty: form.hasBounty ? parseNumber(form.bounty) : 0,
      date: fromLocalInput(form.date),
      note: form.note.trim() ? form.note.trim() : undefined,
    };
    onSubmit(draft);
  };

  return (
    <div className={dialog.backdrop} onClick={onCancel}>
      <div
        className={dialog.dialog}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <div className={dialog.title}>
          {title}
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <label className={dialog.field}>
          <span className={dialog.fieldLabel}>比赛名称</span>
          <input
            ref={nameRef}
            type="text"
            value={form.name}
            onChange={(e) => patch('name', e.target.value)}
            spellCheck={false}
            placeholder="如 周末 MTT"
          />
        </label>

        <div className={dialog.field}>
          <span className={dialog.fieldLabel}>图标</span>
          <IconPicker value={form.iconId} onChange={(id) => patch('iconId', id)} />
        </div>

        <div className={dialog.field}>
          <span className={dialog.fieldLabel}>结算币种</span>
          <div className={home.currencyRow} role="radiogroup" aria-label="结算币种">
            {CURRENCIES.map((c) => {
              const active = c.id === form.currency;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`${home.currencyBtn} ${active ? home.currencyBtnActive : ''}`}
                  onClick={() => patch('currency', c.id)}
                >
                  <span className={home.currencySymbol}>{c.symbol}</span>
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={home.fieldRow}>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>比赛总人数</span>
            <input
              className={home.inputNumber}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.totalPlayers}
              onChange={(e) => patch('totalPlayers', e.target.value)}
            />
          </label>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>每桌人数</span>
            <input
              className={home.inputNumber}
              type="number"
              inputMode="numeric"
              min={0}
              value={form.tablePlayers}
              onChange={(e) => patch('tablePlayers', e.target.value)}
            />
          </label>
        </div>

        <div className={home.fieldRow}>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>
              买入金额（{currencyMeta(form.currency).symbol}）
            </span>
            <input
              className={home.inputNumber}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={form.buyIn}
              onChange={(e) => patch('buyIn', e.target.value)}
            />
          </label>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>
              奖金（{currencyMeta(form.currency).symbol}）
            </span>
            <input
              className={home.inputNumber}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={form.prize}
              onChange={(e) => patch('prize', e.target.value)}
            />
          </label>
        </div>

        <div className={home.bountyBlock}>
          <label className={home.bountyToggle}>
            <input
              type="checkbox"
              checked={form.hasBounty}
              onChange={(e) => patch('hasBounty', e.target.checked)}
            />
            <span className={home.bountyToggleLabel}>赏金赛（PKO / KO）</span>
          </label>
          {form.hasBounty && (
            <label className={dialog.field}>
              <span className={dialog.fieldLabel}>
                赏金金额（{currencyMeta(form.currency).symbol}）
              </span>
              <input
                className={home.inputNumber}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={form.bounty}
                onChange={(e) => patch('bounty', e.target.value)}
                placeholder="本场赚到的赏金"
                autoFocus
              />
              <span className={dialog.fieldHint}>
                赏金会与奖金一起计入 ROI / 总奖金 / 行盈亏
              </span>
            </label>
          )}
        </div>

        <div className={home.fieldRow}>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>最后名次</span>
            <input
              className={home.inputNumber}
              type="number"
              inputMode="numeric"
              min={1}
              value={form.finalRank}
              onChange={(e) => patch('finalRank', e.target.value)}
            />
          </label>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>时间</span>
            <input
              className={home.inputDate}
              type="datetime-local"
              value={form.date}
              onChange={(e) => patch('date', e.target.value)}
            />
            <span className={dialog.fieldHint}>留空则使用创建时间</span>
          </label>
        </div>

        <label className={dialog.field}>
          <span className={dialog.fieldLabel}>备注</span>
          <input
            type="text"
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            placeholder="可选"
          />
        </label>

        {errMsg && <div className={dialog.error}>{errMsg}</div>}

        <div className={dialog.footer}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={submit}>
            {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
