/** "1 certificate", "2 certificates": the noun is singular for exactly one. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** What the delete confirmation says is removed, from the live counts (`deleteSummary` extra fields are ignored). */
export function shipDeleteText(counts: { crew: number; certificates: number; voyages: number }): string {
  return (
    `This removes ${counts.crew} crew, ${count(counts.certificates, 'certificate', 'certificates')} ` +
    `and ${count(counts.voyages, 'voyage', 'voyages')} from this device. A backup made earlier still contains them.`
  );
}
