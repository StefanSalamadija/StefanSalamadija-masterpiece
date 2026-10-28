import { useEffect, useState } from 'preact/hooks';
import { reportError } from '../../app/errors';
import { fetchReleaseInfo, updateBannerText } from '../../app/releaseInfo';
import type { ReleaseInfo } from '../../app/releaseInfo';
import { applyUpdate, onUpdateAvailable } from '../../app/swUpdate';

/** Shown when a new version is waiting. It says what is new, when the release note can be fetched. */
export function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [info, setInfo] = useState<ReleaseInfo | null>(null);

  useEffect(() => onUpdateAvailable(() => setAvailable(true)), []);

  useEffect(() => {
    if (!available) return;
    let current = true;
    void fetchReleaseInfo().then((result) => {
      if (current) setInfo(result);
    });
    return () => {
      current = false;
    };
  }, [available]);

  if (!available) return null;
  return (
    <div class="update-banner no-print" role="status">
      <div class="container banner-inner">
        <span class="banner-text">
          {updateBannerText(info)}
          <span aria-hidden="true"> — </span>
        </span>
        <button type="button" class="btn btn-primary btn-small" onClick={() => applyUpdate().catch(reportError)}>
          Update
        </button>
      </div>
    </div>
  );
}
