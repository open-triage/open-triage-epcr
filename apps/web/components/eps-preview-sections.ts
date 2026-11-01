/** Display populated sections first without changing the immutable outgoing document. */
export function epsPreviewSections<T extends {emptyReason?:unknown}>(sections:readonly T[]):T[]{
 return [...sections].sort((a,b)=>Number(!!a.emptyReason)-Number(!!b.emptyReason));
}
