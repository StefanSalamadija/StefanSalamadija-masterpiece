/**
 * Why a file can't be used as a form. Each message is the exact text shown to the person, and says what to do next
 * where there is something to do, so the UI shows `err.message` for any of them.
 */
export class FormFileError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name; // literal strings, not `new.target.name`, which a minifier would mangle
  }
}

/** A `.doc` or `.xls` (the old binary Office formats). */
export class OldFormatError extends FormFileError {
  constructor() {
    super('This is an old Word or Excel format. Open it once in Word or Excel and save it as .docx or .xlsx, then import that file.', 'OldFormatError');
  }
}

/** A macro-enabled file (`.docm`, `.dotm`, `.xlsm`, or any package with a VBA project). Macros are never imported. */
export class MacroFileError extends FormFileError {
  constructor() { super("Files with macros can't be imported. Save a copy without macros (.docx or .xlsx) and import that.", 'MacroFileError'); }
}

/** Anything that is not a Word or Excel form: another file type, or an Office package with no main part. */
export class NotAFormError extends FormFileError {
  constructor() { super("This file isn't a Word or Excel form.", 'NotAFormError'); }
}

/** More than 20 MB. */
export class FormTooLargeError extends FormFileError {
  constructor() { super('This file is too large to be a form (over 20 MB).', 'FormTooLargeError'); }
}

/**
 * A zip that can't be read, has too many entries or inflates to too much, or an XML part that isn't well-formed or
 * carries a `<!DOCTYPE`. One message for all of them: the person can do nothing different for any.
 */
export class DamagedFormError extends FormFileError {
  constructor() { super("This file couldn't be read. It may be damaged.", 'DamagedFormError'); }
}

/**
 * A value a writer (Word or Excel) refuses because it has no place to go in the form: a field whose address no longer
 * fits the file, a formula cell, a choice that is not one of the options, more rows than a table holds. The message
 * names the field (its id and label). `makeFile` lets it through as it is, so the app can show which value has no
 * place; no file is made and the draft is not changed.
 */
export class FormWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormWriteError';
  }
}

/** What the person reads when a made file fails its check (Global Constraints, exact). */
export const INTEGRITY_MESSAGE = 'The file couldn\'t be made correctly, so it wasn\'t shared. Nothing was lost \u2014 your draft is still here.';

/**
 * A made file that failed its check before it was handed over (`verifyOutput`): a part that should not have changed
 * did, a part is missing or unexpected, a written XML part does not parse, or a value does not read back as it was
 * written. The file is never shared. `message` is the text the person reads; `reason` says which check failed, for
 * the log and the tests, and is never shown.
 */
export class IntegrityError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(INTEGRITY_MESSAGE, options);
    this.name = 'IntegrityError';
    this.reason = reason;
  }
}
