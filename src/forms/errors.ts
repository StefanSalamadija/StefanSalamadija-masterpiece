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
