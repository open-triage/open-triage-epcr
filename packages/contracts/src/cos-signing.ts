export type CosPatientDemographics = {
 firstName: string | null; middleNames: string | null; lastName: string | null;
 birthDate: string | null; gender: string | null;
};
export type CosPatientComparison = {
 reportId: string; revision: number; deliveryId: string; identifier: string;
 local: CosPatientDemographics; cos: CosPatientDemographics;
 displayName: string; canApply: boolean;
 /** The saved draft passed the same identity/demographics check used for delivery. */
 matches?: boolean;
 changes: Array<{elementId: string; kind: 'text'|'date'|'coded'; value: string}>;
};
export type CosSigningIssue = {
 code:string; coverage?:'partial'|'note-pdf-only'; artifact?:string; mappingId?:string; occurrenceId?:string;
 elementId?:string; groupId?:string; groupInstanceId?:string;
 receiverError?: {httpStatus:number; reason:string};
};
