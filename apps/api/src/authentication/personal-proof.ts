import { createHash } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

export type PersonalAuthenticationPurpose = "login" | "switch" | "reauthenticate";
/** Installation-approved contract, never inferred from discovery or an arbitrary AMR. */
export type PersonalProofPolicy = {
  id: string; groupId: string; issuer: string; providerId: string; clientId: string;
  acr: string; requiredAmr: string[];
  purposeClaim?: string; purposes?: Record<PersonalAuthenticationPurpose, string>;
};
const purposes = ["login", "switch", "reauthenticate"] as const;
const bounded = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
export function approvedPersonalProofPolicy(binding: Pick<PersonalProofPolicy, "groupId" | "issuer" | "providerId" | "clientId">): PersonalProofPolicy {
  try {
    const configured: unknown = JSON.parse(process.env.OIDC_PERSONAL_PROOF_POLICIES_JSON ?? "[]");
    if (!Array.isArray(configured) || configured.length > 100) throw new Error();
    const matching = configured.filter(policy => policy && typeof policy === "object" &&
      policy.groupId === binding.groupId && policy.issuer === binding.issuer &&
      policy.providerId === binding.providerId && policy.clientId === binding.clientId);
    if (matching.length !== 1) throw new Error();
    const policy = matching[0];
    if (Object.keys(policy).some(key => !["id", "groupId", "issuer", "providerId", "clientId", "acr", "requiredAmr", "purposeClaim", "purposes"].includes(key)) ||
      !bounded(policy.id) || !bounded(policy.acr) ||
      !Array.isArray(policy.requiredAmr) || !policy.requiredAmr.length || policy.requiredAmr.length > 20 || !policy.requiredAmr.every(bounded) ||
      new Set(policy.requiredAmr).size !== policy.requiredAmr.length) throw new Error();
    if (policy.purposeClaim !== undefined || policy.purposes !== undefined) {
      if(!bounded(policy.purposeClaim) || ["iss", "sub", "aud", "exp", "iat", "nonce", "auth_time", "acr", "amr"].includes(policy.purposeClaim) ||
        !policy.purposes || typeof policy.purposes !== "object" || Array.isArray(policy.purposes) ||
        Object.keys(policy.purposes).length !== 3 || !purposes.every(purpose => bounded(policy.purposes[purpose])) ||
        new Set(purposes.map(purpose => policy.purposes[purpose])).size !== 3) throw new Error();
    }
    return policy as PersonalProofPolicy;
  } catch { throw new ServiceUnavailableException({ code: "login.personalProofUnavailable" }); }
}
export function personalProofPolicyDigest(policy: PersonalProofPolicy): string {
  return createHash("sha256").update(JSON.stringify({id:policy.id,groupId:policy.groupId,providerId:policy.providerId,
    issuer:policy.issuer,clientId:policy.clientId,acr:policy.acr,requiredAmr:[...policy.requiredAmr].sort(),
    ...(policy.purposeClaim?{purposeClaim:policy.purposeClaim,purposes:{login:policy.purposes!.login,switch:policy.purposes!.switch,reauthenticate:policy.purposes!.reauthenticate}}:{})})).digest("hex");
}
const verified = new WeakSet<object>();
export type ValidatedPersonalProof = Readonly<{ issuer: string; purpose: PersonalAuthenticationPurpose; authenticatedAt: Date; policy: PersonalProofPolicy }>;
/** Call only with signature/issuer/audience/nonce validated ID-token claims. */
export function validatePersonalProof(claims: Record<string, unknown>, policy: PersonalProofPolicy,
  purpose: PersonalAuthenticationPurpose, beganAt: Date, now = new Date()): ValidatedPersonalProof {
  const authTime = claims.auth_time;
  if (!purposes.includes(purpose) || claims.iss !== policy.issuer || claims.acr !== policy.acr ||
    !Array.isArray(claims.amr) || claims.amr.length > 20 || !claims.amr.every(bounded) ||
    !policy.requiredAmr.every(method => (claims.amr as unknown[]).includes(method)) ||
    policy.purposeClaim !== undefined && claims[policy.purposeClaim] !== policy.purposes![purpose] ||
    typeof authTime !== "number" || !Number.isSafeInteger(authTime) ||
    authTime < Math.floor(beganAt.getTime() / 1000)+1 || authTime * 1000 > now.getTime() ||
    now.getTime() - beganAt.getTime() > 5 * 60 * 1000) throw new Error("Personal authentication proof rejected");
  const proof = Object.freeze({ issuer: policy.issuer, purpose, authenticatedAt: new Date(authTime * 1000), policy });
  verified.add(proof);
  return proof;
}
export function assertValidatedPersonalProof(proof: ValidatedPersonalProof): void {
  if (!verified.has(proof)) throw new Error("Validated personal authentication required");
}
