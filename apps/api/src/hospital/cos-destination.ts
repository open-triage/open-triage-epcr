import type { SignedOccurrence } from '../reports/signed-report-pdf.js';
/** Missing documentation uses the ambulance unit; partial destination evidence must be resolved. */
export function cosDestinationRequested(rows:SignedOccurrence[]):boolean {
 return rows.some(row=>['eDisposition.01','eDisposition.02'].includes(row.element_id)&&
  (!!(row.provenance_detail as {destinationSelection?:unknown}|null)?.destinationSelection||(!['null','absent'].includes(row.value_kind)&&!row.not_value_code&&!row.pertinent_negative_code)));
}
