/** The backup password for this session only: a module variable, never written to storage, gone when the app closes. */
let remembered: string | undefined;

export function rememberPassword(pw: string): void {
  remembered = pw;
}

export function getRememberedPassword(): string | undefined {
  return remembered;
}

export function forgetPassword(): void {
  remembered = undefined;
}
