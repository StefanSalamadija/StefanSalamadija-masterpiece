import { describe, expect, it } from 'vitest';
import type { FieldDef, FormSchema, FormSetup } from '../forms/types';
import { alignLeftEmpty } from './formSetup';

const field = (id: string, extra: Partial<FieldDef> = {}): FieldDef => ({ id, kind: 'text', label: id, section: '', loc: id, confidence: 'high', ...extra });

const SCHEMA: FormSchema = {
  kind: 'docx',
  identity: { code: 'TST-01', title: 'Toolbox Talk', revision: '00' },
  fields: [field('f1'), field('f2', { leftEmpty: true }), field('f3', { kind: 'time' })],
  rowGroups: [{
    id: 'g1', label: 'Participants', section: '', loc: 'g1', capacity: 12, growable: false, shape: 'rows',
    columns: [field('g1.c1'), field('g1.c2', { leftEmpty: true })],
  }],
  unsupported: [],
};

const SETUP: FormSetup = {
  links: { f1: { source: 'vessel.name' } },
  leftEmpty: ['f3', 'g1.c1'],
  helpers: { pickCrew: ['g1'], allOk: [], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: ['f3', 'g1.c1'] },
  okWord: 'Satisfactory',
  notFinished: '',
};

describe('alignLeftEmpty', () => {
  it("marks exactly the setup's left-empty fields and columns as left empty in the schema", () => {
    const { schema } = alignLeftEmpty(SCHEMA, SETUP);
    const flagged = [...schema.fields, ...schema.rowGroups.flatMap((g) => g.columns)].filter((f) => f.leftEmpty).map((f) => f.id);
    expect(flagged).toEqual(['f3', 'g1.c1']);
    expect('leftEmpty' in schema.fields[1]).toBe(false); // the detected signature the person chose to fill
    expect(schema.rowGroups[0].columns[1]).not.toHaveProperty('leftEmpty');
  });

  it('takes a field that is left empty out of every helper, and keeps the rest', () => {
    const { setup } = alignLeftEmpty(SCHEMA, SETUP);
    expect(setup.helpers.now).toEqual([]);
    expect(setup.helpers.pickCrew).toEqual(['g1']);
    expect(setup.leftEmpty).toEqual(['f3', 'g1.c1']);
    expect(setup.links).toEqual(SETUP.links);
  });

  it('changes neither input, and gives the same result again', () => {
    const before = structuredClone([SCHEMA, SETUP]);
    const once = alignLeftEmpty(SCHEMA, SETUP);
    expect(alignLeftEmpty(once.schema, once.setup)).toEqual(once);
    expect([SCHEMA, SETUP]).toEqual(before);
  });
});
