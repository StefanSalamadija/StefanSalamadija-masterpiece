import { describe, expect, it } from 'vitest';
import type { DraftValues, FieldDef, FormKind, FormSchema, FormSetup, RowGroupDef } from './types';
import { DEFAULT_OK_WORD } from './types';

// These are checked by `npm run typecheck`: a field or group with no `loc`, or a Word group with a `firstRow` of the
// wrong type, does not compile.
describe('the form model', () => {
  it('holds a Word form: ids in document order, a stored location for every field and group', () => {
    const column: FieldDef = { id: 'g1.c1', kind: 'text', label: 'Name', section: 'Participants', loc: '0/1', confidence: 'high' };
    const group: RowGroupDef = { id: 'g1', label: 'Participants', section: 'Participants', loc: 'word/document.xml#0/5/3/2', columns: [column], capacity: 12, growable: true, shape: 'rows' };
    const field: FieldDef = { id: 'f1', kind: 'date', label: 'Date', section: '', loc: 'word/document.xml#0/5/1/0', formatHint: 'dd/MMM/yyyy', confidence: 'high' };
    const schema: FormSchema = { kind: 'docx', identity: { code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' }, fields: [field], rowGroups: [group], unsupported: [] };
    expect(schema.rowGroups[0].columns[0].loc).toBe('0/1');
    expect(schema.rowGroups[0].firstRow).toBeUndefined();
  });

  it('holds an Excel group with the sheet row of its first row, and the draft values of both', () => {
    const column: FieldDef = { id: 'Sheet1!B10', kind: 'number', label: 'Qty', section: '', loc: 'B', confidence: 'low' };
    const group: RowGroupDef = { id: 'Sheet1!g1', label: 'Stores', section: '', loc: 'xl/worksheets/sheet1.xml!A10', firstRow: 10, columns: [column], capacity: 120, growable: false, rowLabels: ['Rope'], shape: 'rows' };
    const kind: FormKind = 'xlsx';
    const values: DraftValues = { fields: { 'Sheet1!B3': '2026-10-28' }, rows: { [group.id]: [{ [column.id]: '4' }] } };
    expect(kind).toBe('xlsx');
    expect(group.firstRow! + 27).toBe(37);
    expect(values.rows[group.id]).toHaveLength(1);
  });

  it('holds the setup, with the default OK word', () => {
    const setup: FormSetup = {
      links: { f1: { source: 'vessel.name' }, f2: { source: 'crew.byRank.master', part: 'nameRank' }, f3: { source: 'none' } },
      leftEmpty: ['f9'],
      helpers: { pickCrew: [], allOk: ['g1'], todayRow: [], startFromLast: [], jobLog: [], thresholds: [], now: [] },
      okWord: DEFAULT_OK_WORD,
      notFinished: 'Pending',
    };
    expect(setup.okWord).toBe('Satisfactory');
  });
});
