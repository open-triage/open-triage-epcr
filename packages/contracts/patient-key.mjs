import { createHmac } from "node:crypto";

export const PATIENT_KEY_DOMAIN = "open-triage.patient-key.v1";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function patientKeyConfigFromEnvironment(environment) {
  const installationId = environment.PATIENT_KEY_INSTALLATION_ID;
  const versionText = environment.PATIENT_KEY_VERSION;
  const secretText = environment.PATIENT_KEY_SECRET_BASE64;
  if (!installationId || !uuidPattern.test(installationId)) {
    throw new Error("PATIENT_KEY_INSTALLATION_ID must be a UUID");
  }
  if (!versionText || !/^[1-9]\d*$/.test(versionText) || !Number.isSafeInteger(Number(versionText))) {
    throw new Error("PATIENT_KEY_VERSION must be a positive safe integer");
  }
  if (!secretText || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(secretText)) {
    throw new Error("PATIENT_KEY_SECRET_BASE64 must be canonical base64");
  }
  const secret = Buffer.from(secretText, "base64");
  if (secret.byteLength < 32) throw new Error("PATIENT_KEY_SECRET_BASE64 must decode to at least 32 bytes");
  return { installationId: installationId.toLowerCase(), keyVersion: Number(versionText), secret };
}

/**
 * Known limitation (by design, not a bug): callers each mint a fresh, random
 * `patientId` per encounter (see draft-report.service.ts and
 * assigned-calls.service.ts), so this HMAC does not produce the same
 * pseudonym across two encounters for the same real-world patient. There is
 * no cross-encounter linkage. Do not "fix" this by deriving the HMAC input
 * from stable patient identity (e.g. name/DOB/MRN) instead of the random
 * per-encounter id — that would reintroduce a re-identification/linkage risk
 * this design deliberately avoids. If cross-encounter linkage is ever
 * required, it needs its own explicit design and risk review, not a change
 * to this helper's input.
 */
export function derivePatientKey(config, organizationId, patientId) {
  if (!uuidPattern.test(organizationId)) throw new Error("organizationId must be a UUID");
  if (!uuidPattern.test(patientId)) throw new Error("patientId must be a UUID");
  const input = [
    PATIENT_KEY_DOMAIN,
    config.installationId.toLowerCase(),
    String(config.keyVersion),
    organizationId.toLowerCase(),
    patientId.toLowerCase()
  ].join("\0");
  return createHmac("sha256", config.secret).update(input, "utf8").digest("hex");
}
