let pending: string | undefined;

/** Leaves a message for the next screen to show once, such as "Imported 3 crew." after the import wizard. */
export function setFlash(message: string): void {
  pending = message;
}

/** The message left by `setFlash`, if any. It is handed over once: the next call finds none. */
export function takeFlash(): string | undefined {
  const message = pending;
  pending = undefined;
  return message;
}
