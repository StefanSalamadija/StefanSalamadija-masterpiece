import { useMemo } from 'preact/hooks';
import { useAppState } from '../../app/AppState';
import { listForShip } from '../../db/records';
import type { Certificate } from '../../domain/types';
import { BandBadge } from '../components/BandBadge';
import { certificateDetails, certificateRows } from '../certificateListView';
import { useLive } from '../useLive';

function CertificateList({ shipId }: { shipId: string }) {
  const { db, shipToday } = useAppState();
  const certificates = useLive(() => listForShip<Certificate>(db, 'certificates', shipId), [db, shipId]);
  // Worked out when the register or the ship's date changes, not on every render.
  const rows = useMemo(() => certificates && certificateRows(certificates, shipToday), [certificates, shipToday]);

  return (
    <section class="screen">
      <div class="screen-head">
        <h2>Certificates</h2>
        <div class="head-actions">
          <a class="btn btn-primary" href="#/ship/certificates/new">Add certificate</a>
        </div>
      </div>
      {rows?.length === 0 && <p class="empty">No certificates yet. Add a certificate to start the register.</p>}
      {rows && rows.length > 0 && (
        <ul class="cert-list" role="list" aria-label="Certificates">
          {rows.map(({ certificate, band }) => {
            const details = certificateDetails(certificate);
            return (
              <li key={certificate.id} class="card cert-row">
                <a class="cert-link" href={`#/ship/certificates/${encodeURIComponent(certificate.id)}`}>
                  <span class="cert-row-head">
                    <span class="cert-name">{certificate.name}</span>
                    <BandBadge band={band} kind="certificate" />
                  </span>
                  {details.length > 0 && (
                    <span class="cert-details">{details.map((detail) => <span key={detail}>{detail}</span>)}</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The active ship's certificates: overdue ones first, then those due soon, then the rest. A row opens the certificate. */
export function Certificates() {
  const { activeShip } = useAppState();
  if (!activeShip) return null;
  // Keyed by ship, so that switching ships does not carry the old register across.
  return <CertificateList key={activeShip.id} shipId={activeShip.id} />;
}
