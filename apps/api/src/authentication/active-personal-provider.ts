import { ServiceUnavailableException } from "@nestjs/common";
import { approvedPersonalProofPolicy } from "./personal-proof.js";

/** One approved active integration contract for login and rollout readiness.
 * Mutable draft discovery is never a substitute for an active snapshot. */
export function activePersonalProofPolicy(version: {
  group_id: string; provider_id: string; configuration: {issuer: string; clientId: string};
  discovery_health: string; discovery: {issuer?: string; pkceS256?: boolean} | null; encrypted_credential: unknown;
}) {
  if (version.discovery_health !== "healthy" || !version.discovery || !version.encrypted_credential ||
    version.discovery.pkceS256 !== true || version.discovery.issuer !== version.configuration.issuer) {
    throw new ServiceUnavailableException({code: "login.personalProofUnavailable"});
  }
  return approvedPersonalProofPolicy({groupId: version.group_id,providerId: version.provider_id,
    issuer: version.configuration.issuer,clientId: version.configuration.clientId});
}
