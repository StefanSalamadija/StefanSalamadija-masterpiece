import { useAppState } from '../../../app/AppState';
import { balancesByMonth } from '../../../budget/ledger';
import { formatMoney } from '../../../budget/money';
import { listBudget, listCategories } from '../../../db/budget';
import { useLive } from '../../useLive';
import { BudgetFrame, useCurrentYm } from './Frame';
import { monthLabel } from './quickAddView';

/** The bank at the end of this month; or, while no bank balance was ever entered, the way to the starting balances. */
function Balances({ ym }: { ym: string }) {
  const { db } = useAppState();
  const bank = useLive(async () => {
    const [entries, corrections, debts, assets, categories, fundMoves, funds, recurring] = await Promise.all([
      listBudget(db, 'budgetEntries'), listBudget(db, 'budgetCorrections'), listBudget(db, 'budgetDebts'), listBudget(db, 'budgetAssets'),
      listCategories(db), listBudget(db, 'budgetFundMoves'), listBudget(db, 'budgetFunds'), listBudget(db, 'budgetRecurring'),
    ]);
    if (!corrections.some((c) => c.account === 'bank')) return null;
    const { balances } = balancesByMonth({ entries, corrections, debts, assets, categories, fundMoves, funds, recurring, fromYm: ym, toYm: ym });
    return balances.get(ym)!.bank;
  }, [db, ym]);
  if (bank === undefined) return null;
  if (bank === null) {
    return (
      <ul class="alert-list" role="list" aria-label="Get started">
        <li class="card alert-row">
          <a class="alert-link" href="#/budget/plan/start">
            <span class="alert-title">Starting balances</span>
            <span class="alert-detail">Enter your bank balance, investments, emergency fund and debts to start</span>
          </a>
        </li>
      </ul>
    );
  }
  return <p class="budget-surplus">Bank & cash {formatMoney(bank)}</p>;
}

/** `/budget`: the way into the budget. The dashboard's figures (pots, forecast, funds, net worth) come with the next screens. */
export function Dashboard() {
  const ym = useCurrentYm();
  return (
    <BudgetFrame title="Budget">
      <Balances ym={ym} />
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
export const Trends = () => <Placeholder title="Trends" />;
export const ImportBudget = () => <Placeholder title="Import from Excel" />;
export const ExportBudget = () => <Placeholder title="Export to Excel" />;
