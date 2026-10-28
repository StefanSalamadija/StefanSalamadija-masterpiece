import { describe, expect, it } from 'vitest';
import { CREW_DOC_TYPES } from '../domain/catalogues';
import type { CrewDocument } from '../domain/types';
import {
  blankCrewDocumentForm, CREW_DOCUMENT_CONTROLS, crewDocumentFieldsOf, crewDocumentFormOf, crewDocumentGroups,
  crewDocumentPatchOf, crewDocumentProblems, isGraded, problemsByControl, withDocumentType,
} from './crewDocumentForm';
import type { CrewDocumentFields, CrewDocumentForm } from './crewDocumentForm';

function document(over: Partial<CrewDocument> = {}): CrewDocument {
  return {
    id: 'doc-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device', deleted: false,
    scope: 'ship', shipId: 'ship-1', crewId: 'crew-1', type: 'coc', grade: 'Master (unlimited)', number: 'CoC-123',
    issuedBy: 'Croatia', issueDate: '2024-05-01', expiryDate: '2029-05-01', remarks: 'Original sighted', ...over,
  };
}

function form(over: Partial<CrewDocumentForm> = {}): CrewDocumentForm {
  return { ...crewDocumentFormOf(document()), ...over };
}

/** The fields of a form that has a document chosen. */
function fieldsOf(f: CrewDocumentForm): CrewDocumentFields {
  const fields = crewDocumentFieldsOf(f);
  if (!fields) throw new Error('no document is chosen');
  return fields;
}

describe('the crew document form', () => {
  it('starts empty, with no document chosen', () => {
    const blank = blankCrewDocumentForm();
    expect(Object.values(blank).every((v) => v === '')).toBe(true);
    expect(Object.keys(blank).sort()).toEqual([...CREW_DOCUMENT_CONTROLS].sort());
  });

  describe('is filled from a document', () => {
    it('choosing the paper of the catalogue, and keeping no name of its own', () => {
      expect(crewDocumentFormOf(document())).toEqual({
        type: 'coc', typeOther: '', grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Croatia', issueDate: '2024-05-01',
        expiryDate: '2029-05-01', remarks: 'Original sighted',
      });
    });
    it('choosing Other for a paper of its own, with its name', () => {
      expect(crewDocumentFormOf(document({ type: 'other', typeOther: 'Tanker familiarisation', grade: '' }))).toMatchObject({
        type: 'other', typeOther: 'Tanker familiarisation',
      });
    });
    it('choosing Other for a type the catalogue does not have, so that its name is not lost', () => {
      expect(crewDocumentFormOf(document({ type: 'drone' as never, typeOther: 'Drone licence', grade: '' }))).toMatchObject({
        type: 'other', typeOther: 'Drone licence',
      });
      expect(crewDocumentFormOf(document({ type: 'drone' as never, grade: '' }))).toMatchObject({ type: 'other', typeOther: '' });
    });
    it('with an empty box for the expiry it has not got', () => {
      expect(crewDocumentFormOf(document({ expiryDate: undefined })).expiryDate).toBe('');
    });
  });

  describe('lists the catalogue', () => {
    const groups = crewDocumentGroups();
    it('in its groups, in order, with every paper once and Other apart', () => {
      expect(groups.map((g) => g.group)).toEqual(['Competency', 'Health', 'STCW courses', 'Visas']);
      const listed = groups.flatMap((g) => g.types);
      expect(listed).toHaveLength(CREW_DOC_TYPES.length - 1);
      expect(listed.map((t) => t.key)).not.toContain('other');
      expect(groups[0].types[0]).toEqual({ key: 'coc', label: 'Certificate of Competency (CoC)' });
      expect(groups[2].types).toHaveLength(13);
    });
  });

  describe('grade', () => {
    it('is asked for by the certificates of competency, endorsements and GMDSS only', () => {
      expect(CREW_DOC_TYPES.filter((t) => isGraded(t.key)).map((t) => t.key)).toEqual(['coc', 'endorsement', 'gmdss']);
      expect(isGraded('')).toBe(false);
      expect(isGraded('drone')).toBe(false);
    });
  });

  describe('choosing a document', () => {
    it('sets the type', () => {
      expect(withDocumentType(form({ type: '' }), 'medical').type).toBe('medical');
    });
    it('clears the name when it is a paper of the catalogue, and keeps it for Other', () => {
      const typed = form({ type: 'other', typeOther: 'Tanker familiarisation', grade: '' });
      expect(withDocumentType(typed, 'bst')).toMatchObject({ type: 'bst', typeOther: '' });
      expect(withDocumentType(typed, '')).toMatchObject({ type: '', typeOther: '' });
      expect(withDocumentType(typed, 'other').typeOther).toBe('Tanker familiarisation');
    });
    it('clears the grade when the paper has none, and keeps it among the graded ones', () => {
      expect(withDocumentType(form(), 'medical').grade).toBe('');
      expect(withDocumentType(form(), 'endorsement').grade).toBe('Master (unlimited)');
      expect(withDocumentType(form(), 'other').grade).toBe('');
    });
    it('keeps what else was typed', () => {
      expect(withDocumentType(form({ number: 'X1', remarks: 'note' }), 'medical')).toMatchObject({ number: 'X1', remarks: 'note' });
    });
  });

  describe('is read back as the fields of a document', () => {
    it('as it was filled in', () => {
      expect(fieldsOf(form())).toEqual({
        type: 'coc', grade: 'Master (unlimited)', number: 'CoC-123', issuedBy: 'Croatia', issueDate: '2024-05-01',
        expiryDate: '2029-05-01', remarks: 'Original sighted',
      });
    });
    it('with the name that was typed for Other, trimmed, and no name for any other paper', () => {
      expect(fieldsOf(form({ type: 'other', typeOther: '  Tanker familiarisation ', grade: '' }))).toMatchObject({
        type: 'other', typeOther: 'Tanker familiarisation',
      });
      expect('typeOther' in fieldsOf(form({ type: 'coc', typeOther: 'left over' }))).toBe(false);
    });
    it('with a grade only for the papers that have one', () => {
      expect(fieldsOf(form({ type: 'medical', grade: 'left over' })).grade).toBe('');
      expect(fieldsOf(form({ type: 'gmdss', grade: ' GOC ' })).grade).toBe('GOC');
    });
    it('with the text trimmed', () => {
      expect(fieldsOf(form({ number: ' CoC-123 ', issuedBy: '  Croatia', remarks: ' sighted\n' }))).toMatchObject({
        number: 'CoC-123', issuedBy: 'Croatia', remarks: 'sighted',
      });
    });
    it('without an expiry that is empty, and with the issue date as empty text', () => {
      const fields = fieldsOf(form({ issueDate: '', expiryDate: '' }));
      expect(fields).toMatchObject({ issueDate: '' });
      expect('expiryDate' in fields).toBe(false);
    });
    it('as none while no document is chosen', () => {
      expect(crewDocumentFieldsOf(form({ type: '' }))).toBeUndefined();
    });
  });

  describe('as a change to a saved document', () => {
    it('is the fields of the form', () => {
      const patch = crewDocumentPatchOf(fieldsOf(form({ number: 'CoC-124' })));
      expect(patch).toMatchObject({ type: 'coc', number: 'CoC-124', expiryDate: '2029-05-01' });
    });
    it('clears an expiry that was emptied, and a name Other no longer needs, which a patch does by setting them to undefined', () => {
      const patch = crewDocumentPatchOf(fieldsOf(form({ type: 'medical', grade: '', expiryDate: '' })));
      expect(patch).toHaveProperty('expiryDate', undefined);
      expect(patch).toHaveProperty('typeOther', undefined);
    });
    it('keeps the name of Other', () => {
      const patch = crewDocumentPatchOf(fieldsOf(form({ type: 'other', typeOther: 'Own', grade: '' })));
      expect(patch.typeOther).toBe('Own');
    });
  });

  describe('problems', () => {
    it('are none for a complete form, and for one with only the paper chosen', () => {
      expect(crewDocumentProblems(form())).toEqual([]);
      expect(crewDocumentProblems(form({ number: '', issuedBy: '', issueDate: '', expiryDate: '', remarks: '', grade: '' }))).toEqual([]);
    });
    it('say a document is needed when none is chosen', () => {
      expect(crewDocumentProblems(form({ type: '' }))).toEqual([{ field: 'type', severity: 'error', message: 'Document is required.' }]);
    });
    it('say the name is needed when Other has none', () => {
      expect(crewDocumentProblems(form({ type: 'other', typeOther: '  ' }))).toEqual([
        { field: 'typeOther', severity: 'error', message: 'Document name is required.' },
      ]);
    });
    it("refuse an expiry before the issue date, in the words the brief gives", () => {
      expect(crewDocumentProblems(form({ issueDate: '2026-05-01', expiryDate: '2026-04-01' }))).toEqual([
        { field: 'expiryDate', severity: 'error', message: "Expiry date can't be before the issue date." },
      ]);
    });
    it('refuse a date that is not real', () => {
      expect(crewDocumentProblems(form({ issueDate: '2026-02-30' })).map((p) => p.field)).toEqual(['issueDate']);
    });
  });

  describe('problems by control', () => {
    it('show each problem at the control of the same name, the first one for a control', () => {
      const found = problemsByControl([
        { field: 'type', severity: 'error', message: 'a' }, { field: 'expiryDate', severity: 'error', message: 'b' },
        { field: 'expiryDate', severity: 'error', message: 'c' },
      ]);
      expect(found.get('type')?.message).toBe('a');
      expect(found.get('expiryDate')?.message).toBe('b');
      expect(found.size).toBe(2);
    });
    it('prefers an error to a warning for the same control', () => {
      const found = problemsByControl([
        { field: 'number', severity: 'warning', message: 'w' }, { field: 'number', severity: 'error', message: 'e' },
      ]);
      expect(found.get('number')?.message).toBe('e');
    });
  });

  it('orders the controls top to bottom, so the first one with a problem gets the focus', () => {
    expect(CREW_DOCUMENT_CONTROLS).toEqual(['type', 'typeOther', 'grade', 'number', 'issuedBy', 'issueDate', 'expiryDate', 'remarks']);
  });
});
