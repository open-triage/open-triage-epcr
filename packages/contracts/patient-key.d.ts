export const PATIENT_KEY_DOMAIN: "open-triage.patient-key.v1";

export type PatientKeyConfig = Readonly<{
  installationId: string;
  keyVersion: number;
  secret: Uint8Array;
}>;

export function patientKeyConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): PatientKeyConfig;

export function derivePatientKey(
  config: PatientKeyConfig,
  organizationId: string,
  patientId: string
): string;
