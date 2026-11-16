import { BudgetFrame, useCurrentYm } from './Frame';
import { monthLabel } from './quickAddView';

/** `/budget`: the way into the budget. The dashboard's figures (pots, forecast, funds, net worth) come with the next screens. */
export function Dashboard() {
  const ym = useCurrentYm();
  return (
    <BudgetFrame title="Budget">
      <ul class="alert-list" role="list" aria-label="Budget">
        <li class="card alert-row">
          <a class="alert-link" href={`#/budget/month/${ym}`}>
            <span class="alert-title">{monthLabel(ym)}</span>
            <span class="alert-detail">Pots, entries, items to confirm and the surplus</span>
          </a>
        </li>
        <li class="card alert-row">
          <a class="alert-link" href="#/budget/catch-up">
            <span class="alert-title">Catch up</span>
            <span class="alert-detail">Several entries in a row, after days without entering</span>
          </a>
        </li>
      </ul>
    </BudgetFrame>
  );
}

/** A Budget screen still to be built: it keeps the tabs and "+ Expense", so its link leads somewhere. */
function Placeholder({ title }: { title: string }) {
  return (
    <BudgetFrame title={title}>
      <p class="empty">This part of the budget is not ready yet.</p>
    </BudgetFrame>
  );
}

export const Forecast = () => <Placeholder title="Forecast" />;
export const NetWorth = () => <Placeholder title="Net worth" />;
export const Scenarios = () => <Placeholder title="Scenarios" />;
export const Plan = () => <Placeholder title="Plan" />;
export const Trends = () => <Placeholder title="Trends" />;
export const ImportBudget = () => <Placeholder title="Import from Excel" />;
export const ExportBudget = () => <Placeholder title="Export to Excel" />;
