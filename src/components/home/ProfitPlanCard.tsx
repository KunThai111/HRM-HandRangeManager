import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  computePlanProgress,
  planDisplayName,
  formatPlanDate,
  type ProfitPlan,
} from '@/lib/profitPlans';
import { formatUSD, type Tournament } from '@/lib/tournaments';
import {
  profitPlanActions,
  useProfitPlans,
  type ProfitPlanDraft,
} from '@/store/useProfitPlanStore';
import home from '@/styles/home.module.css';
import { ProfitPlanDialog } from './ProfitPlanDialog';

interface Props {
  tournaments: Tournament[];
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string };

export function ProfitPlanCard({ tournaments }: Props) {
  const allPlans = useProfitPlans();
  // 首页隐藏已达成的计划（ratio >= 1）；进入「更多计划」页面可看全部。
  const plans = useMemo(
    () =>
      allPlans.filter(
        (p) => computePlanProgress(p, tournaments).ratio < 1,
      ),
    [allPlans, tournaments],
  );
  const [dialogState, setDialogState] = useState<DialogState>({ kind: 'closed' });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  // 选中策略：优先「正在进行中」的第一条（按 startDate 升序），否则取列表第一条
  const defaultActiveId = useMemo(() => {
    if (plans.length === 0) return null;
    const today = todayStart();
    const ongoing = plans.find((p) => {
      const lo = parseLocalDay(p.startDate);
      const hi = parseLocalDay(p.endDate);
      return lo != null && hi != null && lo <= today && today <= hi;
    });
    return (ongoing ?? plans[0]).id;
  }, [plans]);

  // 若 activeId 不在当前列表中（被删 / 首次渲染），回退到默认选中
  const currentId =
    activeId && plans.some((p) => p.id === activeId) ? activeId : defaultActiveId;
  const currentIdx = currentId
    ? plans.findIndex((p) => p.id === currentId)
    : -1;
  const current = currentIdx >= 0 ? plans[currentIdx] : null;

  const goPrev = useCallback(() => {
    if (plans.length === 0) return;
    const i = currentIdx <= 0 ? plans.length - 1 : currentIdx - 1;
    setActiveId(plans[i].id);
  }, [plans, currentIdx]);

  const goNext = useCallback(() => {
    if (plans.length === 0) return;
    const i = currentIdx >= plans.length - 1 ? 0 : currentIdx + 1;
    setActiveId(plans[i].id);
  }, [plans, currentIdx]);

  // 键盘 ← / → 翻页：仅当卡片内部 / 卡片本身 focus 时响应
  useEffect(() => {
    if (plans.length <= 1) return;
    const el = cardRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [plans.length, goPrev, goNext]);

  // 菜单展开时：点击菜单外或按 Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = menuWrapRef.current;
      if (el && !el.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleSubmit = (draft: ProfitPlanDraft) => {
    if (dialogState.kind === 'edit') {
      profitPlanActions.update(dialogState.id, draft);
    } else if (dialogState.kind === 'create') {
      const id = profitPlanActions.add(draft);
      setActiveId(id);
    }
    setDialogState({ kind: 'closed' });
  };

  const handleDelete = (plan: ProfitPlan) => {
    if (confirm(`确定删除「${planDisplayName(plan)}」吗？`)) {
      profitPlanActions.remove(plan.id);
      if (activeId === plan.id) setActiveId(null);
    }
  };

  const editing =
    dialogState.kind === 'edit'
      ? plans.find((p) => p.id === dialogState.id)
      : undefined;

  return (
    <>
      <div
        className={home.planCard}
        ref={cardRef}
        tabIndex={plans.length > 1 ? 0 : -1}
      >
        <div className={home.planHeader}>
          <span className={home.planTitle}>盈利计划</span>
          <div className={home.planMenuWrap} ref={menuWrapRef}>
            <button
              type="button"
              className={`${home.planMenuBtn} ${menuOpen ? home.planMenuBtnOpen : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="计划操作"
            >
              <KebabIcon />
            </button>
            {menuOpen && (
              <div className={home.planMenuPopover} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={home.planMenuItem}
                  disabled={!current}
                  onClick={() => {
                    if (!current) return;
                    setMenuOpen(false);
                    setDialogState({ kind: 'edit', id: current.id });
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={home.planMenuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    setDialogState({ kind: 'create' });
                  }}
                >
                  新增
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${home.planMenuItem} ${home.planMenuItemDanger}`}
                  disabled={!current}
                  onClick={() => {
                    if (!current) return;
                    setMenuOpen(false);
                    handleDelete(current);
                  }}
                >
                  删除
                </button>
                <div className={home.planMenuDivider} aria-hidden />
                <Link
                  to="/plans"
                  role="menuitem"
                  className={home.planMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  更多计划
                </Link>
              </div>
            )}
          </div>
        </div>

        {current ? (
          <PlanBody plan={current} tournaments={tournaments} />
        ) : (
          <div className={home.planEmpty}>
            <div className={home.planEmptyText}>暂无盈利计划</div>
            <button
              type="button"
              className={home.planEmptyBtn}
              onClick={() => setDialogState({ kind: 'create' })}
            >
              + 新增计划
            </button>
          </div>
        )}

        {plans.length > 1 && (
          <div className={home.planNav}>
            <button
              type="button"
              className={home.planNavBtn}
              onClick={goPrev}
              aria-label="上一个计划"
            >
              ‹
            </button>
            <div className={home.planNavDots}>
              {plans.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${home.planDot} ${i === currentIdx ? home.planDotActive : ''}`}
                  onClick={() => setActiveId(p.id)}
                  aria-label={`第 ${i + 1} 个计划`}
                  aria-current={i === currentIdx}
                />
              ))}
            </div>
            <button
              type="button"
              className={home.planNavBtn}
              onClick={goNext}
              aria-label="下一个计划"
            >
              ›
            </button>
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
    </>
  );
}

interface PlanBodyProps {
  plan: ProfitPlan;
  tournaments: Tournament[];
}

function PlanBody({ plan, tournaments }: PlanBodyProps) {
  const progress = useMemo(
    () => computePlanProgress(plan, tournaments),
    [plan, tournaments],
  );

  const { achievedUSD, ratio, matchedCount, state, daysLeft } = progress;
  const isNegative = achievedUSD < 0;
  const isPositive = achievedUSD > 0;
  const ratioPct = Math.round(ratio * 100);
  // 进度条仅在 ratio > 0 时填充；负值显示为空
  const barWidth = Math.max(0, Math.min(1, ratio)) * 100;

  const achievedValueClass = isNegative
    ? home.planAchievedValueNegative
    : isPositive
      ? home.planAchievedValuePositive
      : '';
  const ratioClass = isNegative
    ? home.planRatioNegative
    : isPositive
      ? home.planRatioPositive
      : '';

  const dateRange = `${formatPlanDate(plan.startDate)} – ${formatPlanDate(plan.endDate)}`;

  return (
    <div className={home.planBody}>
      <div className={home.planTargetBlock}>
        <span className={home.planTargetValue}>{formatUSD(plan.targetUSD)}</span>
        <span className={home.planAmountDate}>{dateRange}</span>
      </div>

      <div className={home.planAmounts}>
        <span className={`${home.planAchievedValue} ${achievedValueClass}`}>
          {formatUSD(achievedUSD)}
        </span>
        <span className={`${home.planRatio} ${ratioClass}`}>{ratioPct}%</span>
      </div>

      <div className={home.planBar} aria-hidden>
        <div
          className={`${home.planBarFill} ${isNegative ? home.planBarFillNegative : ''}`}
          style={{ width: `${isNegative ? 0 : barWidth}%` }}
        />
      </div>

      <div className={home.planMeta}>
        <span className={home.metaItem}>
          <TrophyIcon className={home.metaIcon} />
          {matchedCount}
        </span>
        {state !== 'ended' && (
          <>
            <span className={home.planMetaDot}>·</span>
            <span className={home.metaItem}>
              <ClockIcon className={home.metaIcon} />
              {Math.max(0, daysLeft)}
            </span>
          </>
        )}
      </div>

      {plan.note && <div className={home.planNote}>{plan.note}</div>}
    </div>
  );
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseLocalDay(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

function KebabIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

type IconProps = React.SVGProps<SVGSVGElement>;

function TrophyIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 4h10v6a5 5 0 0 1-10 0V4z" />
      <path d="M7 7H4.5a2 2 0 0 0 0 4H7" />
      <path d="M17 7h2.5a2 2 0 0 1 0 4H17" />
      <path d="M9.5 17h5" />
      <path d="M12 14v3" />
      <path d="M9 20h6" />
    </svg>
  );
}

function ClockIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5v3.5l2.4 1.4" />
      <path d="M5 4.5 3.5 6" />
      <path d="m19 4.5 1.5 1.5" />
      <path d="M8.5 3.5 7 2.5" />
      <path d="M15.5 3.5 17 2.5" />
    </svg>
  );
}
