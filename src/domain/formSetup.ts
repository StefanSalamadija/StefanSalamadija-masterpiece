// Types only: the forms engine is loaded on demand, and this is used by `src/db` and the screens, which are in the main bundle.
import type { FieldDef, FormSchema, FormSetup, HelperKey } from '../forms/types';

/**
 * Brings a template's schema and setup into line on which fields are left empty, so that everything that makes a file
 * agrees. The setup holds what the person chose (`setup.leftEmpty`); the schema's `FieldDef.leftEmpty` marks are what the
 * writers, the integrity check, auto-fill and the helpers read. So:
 * - every field and column of the schema is marked `leftEmpty` exactly when `setup.leftEmpty` has its id (a detected
 *   signature the person chose to fill loses its mark; a field the person left empty gets one);
 * - an id that is left empty is taken out of every helper, so that no helper fills it in.
 *
 * Applied whenever a template is stored with a setup: by `saveSetup` and by `replaceTemplate` (a new revision's schema
 * comes with detection's marks, its setup with the person's carried-over choices). Pure: the inputs are not changed, and
 * applying it twice gives the same result.
 */
export function alignLeftEmpty(schema: FormSchema, setup: FormSetup): { schema: FormSchema; setup: FormSetup } {
  const empty = new Set(setup.leftEmpty);
  const mark = (f: FieldDef): FieldDef => {
    const { leftEmpty: _detected, ...rest } = f;
    return empty.has(f.id) ? { ...rest, leftEmpty: true } : rest;
  };
  const helpers = Object.fromEntries(
    Object.entries(setup.helpers).map(([key, ids]) => [key, (ids ?? []).filter((id) => !empty.has(id))]),
  ) as Record<HelperKey, string[]>;
  return {
    schema: { ...schema, fields: schema.fields.map(mark), rowGroups: schema.rowGroups.map((g) => ({ ...g, columns: g.columns.map(mark) })) },
    setup: { ...setup, helpers },
  };
}
