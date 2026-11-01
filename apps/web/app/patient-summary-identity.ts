import { resolveHospitalIdentifier, type ClinicalFormConfiguration, type EncounterDocument, type HospitalIdentifier } from '@open-triage/contracts';

/** Same canonical resolver as the API. Unknown pinned evidence fails closed on every edit. */
export function patientSummaryDocumentKey(documentKey: string, mapping?: HospitalIdentifier, form?: ClinicalFormConfiguration): string {
  if (!mapping || !form) return documentKey;
  try {
    const result = resolveHospitalIdentifier(mapping, JSON.parse(documentKey) as EncounterDocument, form);
    return result.identifier ? JSON.stringify([mapping, result.identifier]) : documentKey;
  } catch { return documentKey; }
}
