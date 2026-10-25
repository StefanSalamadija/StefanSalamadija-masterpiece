import { describe, expect, it } from 'vitest';
import { CERTIFICATES } from '../domain/catalogues';
import type { Certificate } from '../domain/types';
import {
  blankCertificateForm, CERTIFICATE_CONTROLS, certificateFieldsOf, certificateFormOf, certificateGroups, certificatePatchOf,
  certificateProblems, problemsByControl, withCertificate,
} from './certificateForm';
import type { CertificateForm } from './certificateForm';

function certificate(over: Partial<Certificate> = {}): Certificate {
  return {
    id: 'cert-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'device',
    deleted: false, scope: 'ship', shipId: 'ship-1', key: 'loadLine', name: 'International Load Line', number: 'LL-1',
    issuedBy: 'DNV', issueDate: '2026-01-01', expiryDate: '2027-01-01', nextSurveyDue: '2026-12-01', remarks: 'Annual survey', ...over,
  };
}

function form(over: Partial<CertificateForm> = {}): CertificateForm {
  return { ...certificateFormOf(certificate()), ...over };
}

describe('the certificate form', () => {
  it('starts empty, with no certificate chosen', () => {
    const blank = blankCertificateForm();
    expect(Object.values(blank).every((v) => v === '')).toBe(true);
    expect(Object.keys(blank).sort()).toEqual([...CERTIFICATE_CONTROLS].sort());
  });

  describe('is filled from a certificate', () => {
    it('choosing the entry of the catalogue, and keeping no custom name', () => {
      expect(certificateFormOf(certificate())).toEqual({
        key: 'loadLine', customName: '', number: 'LL-1', issuedBy: 'DNV', issueDate: '2026-01-01', expiryDate: '2027-01-01',
        nextSurveyDue: '2026-12-01', remarks: 'Annual survey',
      });
    });
    it('choosing Other for a certificate of its own, with its name', () => {
      expect(certificateFormOf(certificate({ key: 'other', name: 'Fumigation exemption' }))).toMatchObject({
        key: 'other', customName: 'Fumigation exemption',
      });
    });
    it('choosing Other for a key the catalogue does not have, so that its name is not lost', () => {
      expect(certificateFormOf(certificate({ key: 'someFutureKey', name: 'Some future certificate' }))).toMatchObject({
        key: 'other', customName: 'Some future certificate',
      });
    });
    it('with empty boxes for the dates it has not got', () => {
      const f = certificateFormOf(certificate({ expiryDate: undefined, nextSurveyDue: undefined, issueDate: '' }));
      expect(f).toMatchObject({ issueDate: '', expiryDate: '', nextSurveyDue: '' });
    });
  });

  describe('lists the catalogue', () => {
    const groups = certificateGroups();
    it('in its groups, in order, with every certificate once and Other apart', () => {
      expect(groups.map((g) => g.group)).toEqual([
        'Registry and tonnage', 'Statutory safety', 'Pollution and environment', 'Management and security', 'Class', 'Cargo',
        'Liability and insurance', 'Health',
      ]);
      const listed = groups.flatMap((g) => g.certificates);
      expect(listed).toHaveLength(CERTIFICATES.length - 1);
      expect(listed.map((c) => c.key)).not.toContain('other');
      expect(groups[1].certificates.map((c) => c.name)).toContain('International Load Line');
      expect(groups[0].certificates[0]).toEqual({ key: 'registry', name: 'Certificate of Registry' });
    });
  });

  describe('choosing a certificate', () => {
    it('sets the key', () => {
      expect(withCertificate(form({ key: '' }), 'smc').key).toBe('smc');
    });
    it('clears the custom name when it is a certificate of the catalogue', () => {
      expect(withCertificate(form({ key: 'other', customName: 'Fumigation exemption' }), 'smc')).toMatchObject({ key: 'smc', customName: '' });
      expect(withCertificate(form({ key: 'other', customName: 'Fumigation exemption' }), '')).toMatchObject({ key: '', customName: '' });
    });
    it('keeps the custom name for Other', () => {
      expect(withCertificate(form({ key: 'other', customName: 'Fumigation exemption' }), 'other').customName).toBe('Fumigation exemption');
    });
    it('keeps what else was typed', () => {
      expect(withCertificate(form({ number: 'X1', remarks: 'note' }), 'smc')).toMatchObject({ number: 'X1', remarks: 'note' });
    });
  });

  describe('is read back as the fields of a certificate', () => {
    it('with the name of the catalogue entry', () => {
      expect(certificateFieldsOf(form())).toEqual({
        key: 'loadLine', name: 'International Load Line', number: 'LL-1', issuedBy: 'DNV', issueDate: '2026-01-01',
        expiryDate: '2027-01-01', nextSurveyDue: '2026-12-01', remarks: 'Annual survey',
      });
    });
    it('with the name that was typed for Other, trimmed', () => {
      expect(certificateFieldsOf(form({ key: 'other', customName: '  Fumigation exemption ' }))).toMatchObject({
        key: 'other', name: 'Fumigation exemption',
      });
    });
    it('ignoring a custom name left over from Other', () => {
      expect(certificateFieldsOf(form({ key: 'smc', customName: 'Fumigation exemption' }))).toMatchObject({
        key: 'smc', name: 'Safety Management Certificate',
      });
    });
    it('with the text trimmed', () => {
      expect(certificateFieldsOf(form({ number: ' LL-1 ', issuedBy: '  DNV', remarks: ' Annual survey\n' }))).toMatchObject({
        number: 'LL-1', issuedBy: 'DNV', remarks: 'Annual survey',
      });
    });
    it('without the dates that are empty: the issue date is empty text, the others are left out', () => {
      const fields = certificateFieldsOf(form({ issueDate: '', expiryDate: '', nextSurveyDue: '' }));
      expect(fields).toMatchObject({ issueDate: '' });
      expect('expiryDate' in fields).toBe(false);
      expect('nextSurveyDue' in fields).toBe(false);
    });
    it('with no name while nothing is chosen, or Other has none', () => {
      expect(certificateFieldsOf(form({ key: '' })).name).toBe('');
      expect(certificateFieldsOf(form({ key: 'other', customName: '   ' })).name).toBe('');
    });
  });

  describe('as a change to a saved certificate', () => {
    it('is the fields of the form', () => {
      const patch = certificatePatchOf(certificateFieldsOf(form({ number: 'LL-2' })));
      expect(patch).toMatchObject({ key: 'loadLine', number: 'LL-2', expiryDate: '2027-01-01', nextSurveyDue: '2026-12-01' });
    });
    it('clears a date that was emptied, which a patch does by setting it to undefined', () => {
      const patch = certificatePatchOf(certificateFieldsOf(form({ expiryDate: '', nextSurveyDue: '' })));
      expect(patch).toHaveProperty('expiryDate', undefined);
      expect(patch).toHaveProperty('nextSurveyDue', undefined);
    });
  });

  describe('problems', () => {
    it('are none for a complete form, and for one with only the name filled in', () => {
      expect(certificateProblems(form())).toEqual([]);
      expect(certificateProblems(form({ number: '', issuedBy: '', issueDate: '', expiryDate: '', nextSurveyDue: '', remarks: '' }))).toEqual([]);
    });
    it('say the name is needed when no certificate is chosen', () => {
      expect(certificateProblems(form({ key: '' }))).toEqual([
        { field: 'name', severity: 'error', message: 'Certificate name is required.' },
      ]);
    });
    it('say the name is needed when Other has none', () => {
      expect(certificateProblems(form({ key: 'other', customName: '  ' })).map((p) => p.field)).toEqual(['name']);
      expect(certificateProblems(form({ key: 'other', customName: 'Fumigation exemption' }))).toEqual([]);
    });
    it('refuse an expiry before the issue date', () => {
      expect(certificateProblems(form({ issueDate: '2026-05-01', expiryDate: '2026-04-01' }))).toEqual([
        { field: 'expiryDate', severity: 'error', message: "Expiry date can't be before the issue date." },
      ]);
    });
    it('refuse a date that is not real', () => {
      expect(certificateProblems(form({ nextSurveyDue: '2026-02-30' })).map((p) => p.field)).toEqual(['nextSurveyDue']);
    });
  });

  describe('problems by control', () => {
    it('show the missing name at the certificate when none is chosen, and at the name box for Other', () => {
      const none = form({ key: '' });
      expect([...problemsByControl(certificateProblems(none), none).keys()]).toEqual(['key']);
      const other = form({ key: 'other', customName: '' });
      expect([...problemsByControl(certificateProblems(other), other).keys()]).toEqual(['customName']);
    });
    it('show a date problem at its own date', () => {
      const wrong = form({ issueDate: '2026-05-01', expiryDate: '2026-04-01', nextSurveyDue: '2026-13-01' });
      expect([...problemsByControl(certificateProblems(wrong), wrong).keys()].sort()).toEqual(['expiryDate', 'nextSurveyDue']);
    });
    it('keep an error before a warning at one control, and the first of two errors', () => {
      const f = form();
      const byControl = problemsByControl([
        { field: 'expiryDate', severity: 'warning', message: 'w' },
        { field: 'expiryDate', severity: 'error', message: 'e1' },
        { field: 'expiryDate', severity: 'error', message: 'e2' },
      ], f);
      expect(byControl.get('expiryDate')?.message).toBe('e1');
    });
  });

  it('has a control for every field, in the order of the screen', () => {
    expect(CERTIFICATE_CONTROLS).toEqual(['key', 'customName', 'number', 'issuedBy', 'issueDate', 'expiryDate', 'nextSurveyDue', 'remarks']);
  });
});
