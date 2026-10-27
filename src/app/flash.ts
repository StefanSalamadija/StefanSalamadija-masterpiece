/** Messages left for the next screen to show once, in the order they were left. */
let pending: string[] = [];

/** Leaves a message for the next screen to show once, such as "Imported 3 crew." after the import wizard. It replaces anything already waiting. */
export function setFlash(message: string): void {
  pending = [message];
}

/** Adds a message after those already waiting, so that none is lost: "Import complete." and a notice from the screen that came between. */
export function addFlash(message: string): void {
  pending = [...pending, message];
}

/** Takes back a message that `addFlash` (or `setFlash`) left, such as when the thing it told about did not happen after all. The others stay. */
export function dropFlash(message: string): void {
  const at = pending.lastIndexOf(message);
  if (at >= 0) pending = pending.filter((_, i) => i !== at);
}

/** The messages left, joined by a space, or none. They are handed over once: the next call finds none. */
export function takeFlash(): string | undefined {
  const message = pending.length > 0 ? pending.join(' ') : undefined;
  pending = [];
  return message;
}
