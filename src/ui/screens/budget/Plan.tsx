import type { ComponentType } from 'preact';
import { useRoute } from '../../../app/router';
import { unassignedDebtTemplates } from '../../../budget/forecast';
import { BudgetFrame } from './Frame';
import { PlanAssets } from './PlanAssets';
import { PlanAssumptions } from './PlanAssumptions';
import { PlanCategories } from './PlanCategories';
import { PlanDebts } from './PlanDebts';
import { PlanFunds } from './PlanFunds';
import { PlanGoals } from './PlanGoals';
import { PlanFrame, usePlanData } from './planKit';
import type { PlanData } from './planKit';
import { PlanRecurring } from './PlanRecurring';
import { PlanRotation } from './PlanRotation';
import { PlanTargets } from './PlanTargets';

/** The parts of the Plan (v2 §3.7), each at `/budget/plan/<id>`. */
const SECTIONS: { id: string; title: string; detail: string; Screen: ComponentType<{ data: PlanData }> }[] = [
  { id: 'targets', title: 'Targets', detail: "Planned income and each pot's target, month by month", Screen: PlanTargets },
  { id: 'categories', title: 'Categories', detail: 'Add, rename, hide, reorder or move to another pot', Screen: PlanCategories },
  { id: 'recurring', title: 'Recurring', detail: 'Payments and income that repeat every month', Screen: PlanRecurring },
  { id: 'funds', title: 'Sinking funds', detail: 'Yearly bills, set aside month by month', Screen: PlanFunds },
  { id: 'debts', title: 'Debts', detail: 'Balance, rate, instalment and the debt-free month', Screen: PlanDebts },
  { id: 'goals', title: 'Goals', detail: 'Savings goals and the emergency fund target', Screen: PlanGoals },
  { id: 'assets', title: 'Assets', detail: 'A flat or a car: its value, in the net worth or not', Screen: PlanAssets },
  { id: 'rotation', title: 'Rotation', detail: 'Contracts, the pattern for later and the pay rule', Screen: PlanRotation },
  { id: 'assumptions', title: 'Assumptions', detail: 'Return, withdrawal rate, inflation, buffer and horizon', Screen: PlanAssumptions },
];

/** Recurring's flag: the Debts templates that do not say which of the debts they pay (see `unassignedDebtTemplates`). */
function WhichDebtFlag() {
  const data = usePlanData();
  const count = data ? unassignedDebtTemplates(data.recurring, data.categories, data.debts).length : 0;
  if (count === 0) return null;
  return <span class="list-row-meta field-warning">Which debt? {count === 1 ? 'A Debts template does' : `${count} Debts templates do`} not say which debt it pays.</span>;
}

function PlanIndex() {
  return (
    <BudgetFrame title="Plan">
      <ul class="row-list" role="list" aria-label="Plan">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a class="list-row" href={`#/budget/plan/${s.id}`}>
              <span class="list-row-text">
                <span class="list-row-title">{s.title}</span>
                <span class="list-row-meta">{s.detail}</span>
                {s.id === 'recurring' && <WhichDebtFlag />}
              </span>
            </a>
          </li>
        ))}
        <li>
          <a class="list-row" href="#/budget/plan/start">
            <span class="list-row-text">
              <span class="list-row-title">Starting balances</span>
              <span class="list-row-meta">The bank, investments, emergency fund, debts, funds and assets at a start month</span>
            </span>
          </a>
        </li>
      </ul>
    </BudgetFrame>
  );
}

/** Reads the budget once the frame has set it up (it draws its children only then), and draws the section. */
function SectionBody({ Screen }: { Screen: ComponentType<{ data: PlanData }> }) {
  const data = usePlanData();
  return data ? <Screen data={data} /> : <p class="live" role="status">Loading…</p>;
}

/** `/budget/plan`: the parts of the plan; `/budget/plan/:section`: one of them. */
export function Plan() {
  const { params } = useRoute();
  if (params.section === undefined) return <PlanIndex />;
  const section = SECTIONS.find((s) => s.id === params.section);
  if (!section) return <PlanFrame title="Plan"><p class="empty">There is no such part of the plan.</p></PlanFrame>;
  return <PlanFrame title={section.title}><SectionBody key={section.id} Screen={section.Screen} /></PlanFrame>;
}
