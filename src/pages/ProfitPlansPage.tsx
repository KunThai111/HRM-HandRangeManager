import { useMemo, useState } from 'react';
import { ProfitPlanDialog } from '@/components/home/ProfitPlanDialog';
import {
  computePlanProgress,
  planDisplayName,
  type ProfitPlan,
} from '@/lib/profitPlans';
import { formatUSD, type Tournament } from '@/lib/tournaments';
import {
  profitPlanActions,
  useProfitPlans,
  type ProfitPlanDraft,
} from '@/store/useProfitPlanStore';
import { useTournaments } from '@/store/useTournamentStore';
import home from '@/styles/home.module.css';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

const STATE_LABEL = {
  upcoming: '即将开始',
  ongoing: '进行中',
  ended: '已结束',
  achieved: '已达成',
} as const;

const STATE_CLASS = {
  upcoming: home.planStateUpcoming,
  ongoing: home.planStateOngoing,
  ended: home.planStateEnded,
  achieved: home.planStateOngoing,
} as const;

type ListState = keyof typeof STATE_LABEL;

interface PlanRowProps {
  plan: ProfitPlan;
  tournaments: Tournament[];
  onEdit: () => void;
  onDelete: () => void;
}

function PlanRow({ plan, tournaments, onEdit, onDelete }: PlanRowProps) {
  const progress = useMemo(
    () => computePlanProgress(plan, tournaments),
    [plan, tournaments],
  );
  const { achievedUSD, ratio, state } = progress;
  const ratioPct = Math.round(ratio * 100);
  const barWidth = Math.max(0, Math.min(1, ratio)) * 100;
  const isNegative = achievedUSD < 0;
  const isPositive = achievedUSD > 0;
  const isAchieved = ratio >= 1;

  const listState: ListState = isAchieved ? 'achieved' : state;

  const valueClass = isNegative
    ? home.planAchievedValueNegative
    : isPositive
      ? home.planAchievedValuePositive
      : '';
  const ratioClass = isNegative
    ? home.planRatioNegative
    : isPositive
      ? home.planRatioPositive
      : '';

  return (
    <div className={home.planListItem}>
      <div className={home.planListMain}>
        <div className={home.planListTitle}>
          <span className={home.planListName}>{planDisplayName(plan)}</span>
          <span className={`${home.planStateBadge} ${STATE_CLASS[listState]}`}>
            {STATE_LABEL[listState]}
          </span>
        </div>
      </div>

      <div className={home.planListAmounts}>
        <div className={home.planListAmountRow}>
          <span className={home.planListAmountLabel}>目标</span>
          <span className={home.planListAmountValue}>
            {formatUSD(plan.targetUSD)}
          </span>
        </div>
        <div className={home.planListAmountRow}>
          <span className={home.planListAmountLabel}>已达成</span>
          <span className={`${home.planListAmountValue} ${valueClass}`}>
            {formatUSD(achievedUSD)}
          </span>
        </div>
      </div>

      <div className={home.planListProgress}>
        <div className={home.planBar} aria-hidden>
          <div
            className={`${home.planBarFill} ${isNegative ? home.planBarFillNegative : ''}`}
            style={{ width: `${isNegative ? 0 : barWidth}%` }}
          />
        </div>
        <span className={`${home.planListRatio} ${ratioClass}`}>{ratioPct}%</span>
      </div>

      <div className={home.planListActions}>
        <button
          type="button"
          className={home.planActionBtn}
          onClick={onEdit}
          aria-label="编辑计划"
        >
          编辑
        </button>
        <button
          type="button"
          className={`${home.planActionBtn} ${home.planActionBtnDanger}`}
          onClick={onDelete}
          aria-label="删除计划"
        >
          删除
        </button>
      </div>
    </div>
  );
}

export function ProfitPlansPage() {
  const plans = useProfitPlans();
  const tournaments = useTournaments();
  const [dialogState, setDialogState] = useState<DialogState>({ kind: 'closed' });

  const handleSubmit = (draft: ProfitPlanDraft) => {
    if (dialogState.kind === 'edit') {
      profitPlanActions.update(dialogState.id, draft);
    } else if (dialogState.kind === 'create') {
      profitPlanActions.add(draft);
    }
    setDialogState({ kind: 'closed' });
  };

  const handleDelete = (plan: ProfitPlan) => {
    if (confirm(`确定删除「${planDisplayName(plan)}」吗？`)) {
      profitPlanActions.remove(plan.id);
    }
  };

  const editing =
    dialogState.kind === 'edit'
      ? plans.find((p) => p.id === dialogState.id)
      : undefined;

  return (
    <div className={home.page}>
      <div className={home.inner}>
        <h2 className={home.sectionTitle}>全部盈利计划</h2>

        {plans.length === 0 ? (
          <div className={home.tableWrap}>
            <div className={home.empty}>暂无盈利计划</div>
          </div>
        ) : (
          <div className={home.planList}>
            {plans.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                tournaments={tournaments}
                onEdit={() => setDialogState({ kind: 'edit', id: p.id })}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>
        )}
      </div>

      {(dialogState.kind === 'create' || dialogState.kind === 'edit') && (
        <ProfitPlanDialog
          initial={editing}
          onCancel={() => setDialogState({ kind: 'closed' })}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
