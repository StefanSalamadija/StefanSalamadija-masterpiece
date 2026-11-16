/*
 * The whole-cents rule for budget records, nested fields included: what a write is checked against before it is
 * stored, and what a backup file is checked against before it is imported. Pure, with no imports, so the backup
 * service can use it without pulling budget code into the main chunk.
 */

const POT_IDS: ReadonlySet<string> = new Set(['needs', 'savings', 'wants', 'debts', 'emergency']);
/** The top-level fields that hold money, in any budget table. */
const MONEY_FIELDS = ['amount', 'balance', 'startBalance', 'instalment', 'bufferCents'] as const;
/** The money fields of a scenario change. */
const CHANGE_MONEY_FIELDS = ['amount', 'monthly', 'lump'] as const;

/** The fields of an entry that link it to another record: each one is text when it is there. */
const ENTRY_LINK_FIELDS = ['categoryId', 'fundId', 'debtId', 'soldAssetId', 'recurringId'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whole cents: a safe integer. */
export function isCents(value: unknown): boolean {
  return Number.isSafeInteger(value);
}

/** `fields[key]` is absent, or whole cents. */
function optionalCents(fields: Record<string, unknown>, key: string): boolean {
  return fields[key] === undefined || isCents(fields[key]);
}

/** A pot's target: a percentage of income (0 to 100, fractions allowed) or an amount in whole cents. */
function isPotTarget(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'pct') return typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 100;
  return value.kind === 'amount' && isCents(value.value);
}

/** A month's edit of one value: `fromOn` and `thisOnly`, each absent, `null` (no value) or a valid value, and nothing else. */
function isPlanEdit(value: unknown, valid: (v: unknown) => boolean): boolean {
  return isObject(value) && Object.entries(value).every(([key, v]) => (key === 'fromOn' || key === 'thisOnly') && (v === undefined || v === null || valid(v)));
}

/**
 * The money fields of a budget record (or of a patch to one) that are there are whole cents, the nested ones too:
 * a month's pot and category targets, the settings' favourites, fixed spending, salaries and yearly spending, a scenario's changes and a
 * debt's extra steps.
 * A nested field that is there must also have its shape (an object of targets, a list of favourites), since the sums
 * read it without checking again. Missing fields are not this function's business.
 */
export function budgetMoneyOk(fields: Record<string, unknown>): boolean {
  if (!MONEY_FIELDS.every((key) => optionalCents(fields, key))) return false;
  const { plannedIncome, potTargets, categoryTargets, favourites, fixedSpend, rotation, changes, extraSteps, extraApplied, assumptions } = fields;
  if (assumptions !== undefined && !(isObject(assumptions) && optionalCents(assumptions, 'yearlySpendingCents'))) return false;
  if (extraSteps !== undefined && !(Array.isArray(extraSteps) && extraSteps.every((s) => isObject(s) && isCents(s.monthly)))) return false;
  if (extraApplied !== undefined && !(Array.isArray(extraApplied) && extraApplied.every((a) => isObject(a) && isCents(a.monthly)))) return false;
  if (plannedIncome !== undefined && !isPlanEdit(plannedIncome, isCents)) return false;
  if (potTargets !== undefined
    && !(isObject(potTargets) && Object.entries(potTargets).every(([pot, edit]) => POT_IDS.has(pot) && (edit === undefined || isPlanEdit(edit, isPotTarget))))) {
    return false;
  }
  if (categoryTargets !== undefined
    && !(isObject(categoryTargets) && Object.values(categoryTargets).every((edit) => isPlanEdit(edit, isCents)))) {
    return false;
  }
  if (favourites !== undefined && !(Array.isArray(favourites) && favourites.every((f) => isObject(f) && isCents(f.amount)))) return false;
  if (fixedSpend !== undefined
    && !(isObject(fixedSpend) && Object.entries(fixedSpend).every(([pot, c]) => POT_IDS.has(pot) && (c === undefined || isCents(c))))) {
    return false;
  }
  if (rotation !== undefined
    && !(isObject(rotation) && Array.isArray(rotation.salaryFrom) && rotation.salaryFrom.every((s) => isObject(s) && isCents(s.amount)))) {
    return false;
  }
  if (changes !== undefined
    && !(Array.isArray(changes) && changes.every((c) => isObject(c) && CHANGE_MONEY_FIELDS.every((key) => optionalCents(c, key))))) {
    return false;
  }
  return true;
}

/** The links of an entry (or of a patch to one) that are there are text: its category, fund, debt, asset sold, template. */
export function entryLinksOk(fields: Record<string, unknown>): boolean {
  return ENTRY_LINK_FIELDS.every((key) => !(key in fields) || fields[key] === undefined || typeof fields[key] === 'string');
}
