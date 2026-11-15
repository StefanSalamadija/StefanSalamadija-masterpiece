/*
 * The whole-cents rule for budget records, nested fields included: what a write is checked against before it is
 * stored, and what a backup file is checked against before it is imported. Pure, with no imports, so the backup
 * service can use it without pulling budget code into the main chunk.
 */

const POT_IDS: ReadonlySet<string> = new Set(['needs', 'savings', 'wants', 'debts', 'emergency']);
/** The top-level fields that hold money, in any budget table. */
const MONEY_FIELDS = ['amount', 'balance', 'startBalance', 'instalment', 'plannedIncome', 'bufferCents'] as const;
/** The money fields of a scenario change. */
const CHANGE_MONEY_FIELDS = ['amount', 'monthly', 'lump'] as const;

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

/** How a target was set: for its month only, or from its month on. */
const ORIGINS: ReadonlySet<unknown> = new Set(['this', 'fromOn']);

/** A category's target: whole cents, or `null` for one removed on purpose. */
function isCategoryTarget(value: unknown): boolean {
  return isObject(value) && (value.amount === null || isCents(value.amount)) && ORIGINS.has(value.origin);
}

/** A pot's target: a percentage of income (0 to 100, fractions allowed) or an amount in whole cents. */
function isPotTarget(value: unknown): boolean {
  if (!isObject(value) || !ORIGINS.has(value.origin)) return false;
  if (value.kind === 'pct') return typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 100;
  return value.kind === 'amount' && isCents(value.value);
}

/**
 * The money fields of a budget record (or of a patch to one) that are there are whole cents, the nested ones too:
 * a month's pot and category targets, the settings' favourites, fixed spending and salaries, and a scenario's changes.
 * A nested field that is there must also have its shape (an object of targets, a list of favourites), since the sums
 * read it without checking again. Missing fields are not this function's business.
 */
export function budgetMoneyOk(fields: Record<string, unknown>): boolean {
  if (!MONEY_FIELDS.every((key) => optionalCents(fields, key))) return false;
  const { potTargets, categoryTargets, favourites, fixedSpend, rotation, changes } = fields;
  if (potTargets !== undefined
    && !(isObject(potTargets) && Object.entries(potTargets).every(([pot, target]) => POT_IDS.has(pot) && (target === undefined || isPotTarget(target))))) {
    return false;
  }
  if (categoryTargets !== undefined
    && !(isObject(categoryTargets) && Object.values(categoryTargets).every(isCategoryTarget))) {
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
