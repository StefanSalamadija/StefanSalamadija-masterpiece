/** "1 certificate", "2 certificates": the noun is singular for exactly one. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** What `deleteSummary` counts: the live records of a ship, which deleting it removes. */
export interface ShipDeleteCounts {
  crew: number;
  certificates: number;
  voyages: number;
  crewDocuments: number;
  clockChanges: number;
}

/** What the delete confirmation says is removed, from the live counts. "Crew" is the same for one and for many. */
export function shipDeleteText(counts: ShipDeleteCounts): string {
  return (
    `This removes ${counts.crew} crew, ${count(counts.certificates, 'certificate', 'certificates')}, ` +
    `${count(counts.voyages, 'voyage', 'voyages')}, ${count(counts.crewDocuments, 'crew document', 'crew documents')} ` +
    `and ${count(counts.clockChanges, 'clock change', 'clock changes')} from this device. A backup made earlier still contains them.`
  );
}
