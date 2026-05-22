import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProfitPlan } from '@/lib/profitPlans';
import type { ProfitPlanDraft } from '@/store/useProfitPlanStore';
import dialog from '@/styles/dialog.module.css';
import home from '@/styles/home.module.css';

interface Props {
  /** 传入 = 编辑现有；不传 = 新建。 */
  initial?: ProfitPlan;
  onCancel: () => void;
  onSubmit: (draft: ProfitPlanDraft) => void;
}

interface FormState {
  startDate: string;
  endDate: string;
  targetUSD: string;
  note: string;
}

function todayDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildInitial(initial?: ProfitPlan): FormState {
  if (!initial) {
    const today = todayDateStr();
    return {
      startDate: today,
      endDate: today,
      targetUSD: '',
      note: '',
    };
  }
  return {
    startDate: initial.startDate,
    endDate: initial.endDate,
    targetUSD: String(initial.targetUSD ?? 0),
    note: initial.note ?? '',
  };
}

function parseNumber(s: string): number {
  if (!s.trim()) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProfitPlanDialog({ initial, onCancel, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitial(initial));
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const targetRef = useRef<HTMLInputElement | null>(null);

  const isEdit = Boolean(initial);
  const title = useMemo(() => (isEdit ? '编辑盈利计划' : '新增盈利计划'), [isEdit]);

  useEffect(() => {
    targetRef.current?.focus();
    targetRef.current?.select();
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
    const startDate = form.startDate.trim();
    const endDate = form.endDate.trim();
    if (!startDate || !endDate) {
      setErrMsg('请填写开始日期与结束日期');
      return;
    }
    if (endDate < startDate) {
      setErrMsg('结束日期不能早于开始日期');
      return;
    }
    const target = parseNumber(form.targetUSD);
    if (target <= 0) {
      setErrMsg('目标盈利必须大于 0');
      return;
    }
    const draft: ProfitPlanDraft = {
      startDate,
      endDate,
      targetUSD: target,
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
        style={{ maxWidth: 480 }}
      >
        <div className={dialog.title}>
          {title}
          <button className="ghost" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={home.fieldRow}>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>开始日期</span>
            <input
              className={home.inputDate}
              type="date"
              value={form.startDate}
              onChange={(e) => patch('startDate', e.target.value)}
            />
          </label>
          <label className={dialog.field}>
            <span className={dialog.fieldLabel}>结束日期</span>
            <input
              className={home.inputDate}
              type="date"
              value={form.endDate}
              onChange={(e) => patch('endDate', e.target.value)}
            />
          </label>
        </div>

        <label className={dialog.field}>
          <span className={dialog.fieldLabel}>目标盈利（USD）</span>
          <input
            ref={targetRef}
            className={home.inputNumber}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.targetUSD}
            onChange={(e) => patch('targetUSD', e.target.value)}
            placeholder="如 1000"
          />
          <span className={dialog.fieldHint}>
            区间内所有比赛的净盈亏（奖金 + 赏金 − 买入，自动折算为 USD）将累计为已达成
          </span>
        </label>

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
