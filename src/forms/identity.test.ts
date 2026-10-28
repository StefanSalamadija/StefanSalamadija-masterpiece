import { describe, expect, it } from 'vitest';
import { identityFromText } from './identity';

describe('identityFromText', () => {
  it('reads the code, title and revision, with each label and its value on separate lines', () => {
    expect(identityFromText(['Toolbox Talk', 'Form:', 'TST-01', 'Revision:', '00 / 01.01.2026', 'Page: 1 of 1'], 'x.docx'))
      .toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
  });

  it('reads the same from a label and its value on one line, as the header of a form holds them', () => {
    expect(identityFromText(['Toolbox Talk', 'Form: TST-01', 'Revision: 00 / 01.01.2026', 'Page: 1 of 1'], 'x.docx'))
      .toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
  });

  it('reads labels and values that are all in one line, stopping each value at the next label', () => {
    expect(identityFromText(['Toolbox Talk Form: TST-01 Revision: 00 / 01.01.2026 Page: 1 of 1'], 'x.docx'))
      .toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
  });

  it('takes only the first word after Form: as the code', () => {
    expect(identityFromText(['Form: TST-01 (issue 2)', 'Hot Work Permit'], 'x.docx').code).toBe('TST-01');
  });

  it('matches the labels in any case and with non-breaking spaces, and keeps the code as it is written', () => {
    expect(identityFromText(['FORM: tst-03', 'revision : A', 'Weekly Safety Round'], 'x.dotx'))
      .toEqual({ code: 'tst-03', title: 'Weekly Safety Round', revision: 'A' });
  });

  it('takes the longest line that is not a label as the title, the first of equally long ones', () => {
    expect(identityFromText(['Logo', 'Hot Work Permit', 'Form: TST-02', 'Revision: 01 / 02.02.2026', 'Page: 1 of 2', 'Safety Notes'], 'x.docx').title)
      .toBe('Hot Work Permit');
    expect(identityFromText(['Form: TST-02', 'Abc', 'Xyz'], 'x.docx').title).toBe('Abc');
  });

  it('leaves the lines that belong to Approved, Page, Form and Revision out of the title', () => {
    const lines = ['Approved:', 'Master and Company Superintendent', 'Page:', '1 of 3', 'Approved by: Company Superintendent', 'Hot Work Permit', 'Form:', 'TST-02'];
    expect(identityFromText(lines, 'x.docx')).toEqual({ code: 'TST-02', title: 'Hot Work Permit', revision: '' });
  });

  it('does not take a word that only ends in a label word for a label', () => {
    expect(identityFromText(['Platform: Deck 2', 'Form: TST-04'], 'x.docx')).toEqual({ code: 'TST-04', title: 'Platform: Deck 2', revision: '' });
  });

  it('uses the first value when the header is repeated', () => {
    const lines = ['Toolbox Talk', 'Form: TST-01', 'Revision: 00', 'Toolbox Talk', 'Form: TST-99', 'Revision: 07'];
    expect(identityFromText(lines, 'x.docx')).toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00' });
  });

  it('takes the title from the file name, without its extension, when there is no code', () => {
    expect(identityFromText(['Safety Walk Round Checklist', 'Revision: 02'], 'Safety Walk Round.docx'))
      .toEqual({ code: '', title: 'Safety Walk Round', revision: '02' });
    expect(identityFromText([], 'Safety Walk Round.docx')).toEqual({ code: '', title: 'Safety Walk Round', revision: '' });
  });

  it('treats a Form: with nothing after it as no code', () => {
    expect(identityFromText(['Form:', 'Revision: 01', 'Hot Work Permit'], 'permit.docx')).toEqual({ code: '', title: 'permit', revision: '01' });
  });

  it('takes the title from the file name when the code is the only thing in the header', () => {
    expect(identityFromText(['Form: TST-01', 'Page: 1 of 1'], 'Toolbox Talk.xlsx')).toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '' });
  });

  it('removes only the last extension, and none from a name that has none', () => {
    expect(identityFromText([], 'TST-01 v1.2 Toolbox Talk.docx').title).toBe('TST-01 v1.2 Toolbox Talk');
    expect(identityFromText([], 'Toolbox Talk').title).toBe('Toolbox Talk');
    expect(identityFromText([], '.docx').title).toBe('.docx');
  });

  it('ignores empty lines and the spaces around and inside lines', () => {
    expect(identityFromText(['', '  Toolbox   Talk  ', ' ', 'Form:', '', 'TST-01', 'Revision:  00 /  01.01.2026 '], 'x.docx'))
      .toEqual({ code: 'TST-01', title: 'Toolbox Talk', revision: '00 / 01.01.2026' });
  });
});
