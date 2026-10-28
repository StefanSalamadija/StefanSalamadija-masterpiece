export interface ReleaseInfo {
  version: string;
  whatsNew: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isReleaseInfo(value: unknown): value is ReleaseInfo {
  if (typeof value !== 'object' || value === null) return false;
  const { version, whatsNew } = value as Record<string, unknown>;
  return isNonEmptyString(version) && isNonEmptyString(whatsNew);
}

/**
 * The release note of the newest published version, read from `./version.json` on the server (never from a cache).
 * Null when it can't be had for any reason: offline, not found, or not a release note. The banner then falls back to
 * a plain message. Apart from the app's own files (and the service worker's check of its same-origin `sw.js`), this
 * is the only request the app makes, and it sends nothing about the user.
 */
export async function fetchReleaseInfo(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch('./version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isReleaseInfo(body) ? { version: body.version, whatsNew: body.whatsNew } : null;
  } catch {
    return null;
  }
}

/** What the update banner says before its Update button. */
export function updateBannerText(info: ReleaseInfo | null): string {
  return info ? `Version ${info.version} — ${info.whatsNew}` : 'New version available';
}
