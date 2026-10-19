import type { SignedOccurrence } from '../reports/signed-report-pdf.js';
/** Exact NEMSIS 3.5.1 disposition codes; absence/ambiguity never implies care. */
export function cosDispositionCode(rows:SignedOccurrence[],id:string):string|null {
 const found=rows.filter(row=>row.element_id===id);
 return found.length===1&&found[0]!.value_kind==='coded'&&!found[0]!.not_value_code&&!found[0]!.pertinent_negative_code?String(found[0]!.code):null;
}
export function cosEligibility(rows:SignedOccurrence[]):'transported'|'nonTransport'|'excluded'|'waiting' {
 const unit=cosDispositionCode(rows,'eDisposition.27');
 // Cancellation/no contact is distinct from refusal after patient contact.
 if(unit&&['4227003','4227005','4227007','4227009','4227011'].includes(unit))return 'excluded';
 const care=cosDispositionCode(rows,'eDisposition.28'),transport=cosDispositionCode(rows,'eDisposition.30');
 if(unit!=='4227001'||!care||!['4228001','4228003','4228005','4228007','4228009'].includes(care))return 'waiting';
 if(transport&&['4230001','4230003','4230005','4230007'].includes(transport))return 'transported';
 if(transport&&['4230009','4230013'].includes(transport))return 'nonTransport';
 // Non-patient transport, undocumented and contradictory facts require correction.
 return 'waiting';
}
export function cosEligible(rows:SignedOccurrence[]):boolean {
 const eligibility=cosEligibility(rows);return eligibility==='transported'||eligibility==='nonTransport';
}
