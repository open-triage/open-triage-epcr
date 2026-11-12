/** Advance only for a breaking change to the generic Android API contract.
 * Compatible server deployments retain this protocol independently of Git SHA.
 */
export const ANDROID_API_PROTOCOL_VERSION = 1;
export const ANDROID_CLIENT_API_PROTOCOL_RANGE = Object.freeze({ minimum: 1, maximum: 1 });
// Add a capability with its server implementation; native extensions do not
// invalidate older clients that still support the compatible base protocol.
export const ANDROID_API_CAPABILITIES = Object.freeze(["native-enrollment-attempt-v1", "native-enrollment-outcome-v1", "native-oidc-return-v1", "audio-webm-live-v1", "android-upgrade-policy-v1", "native-agency-handoff-v1", "android-upgrade-gate-v1", "personal-session-continuation-v1"]);
export const ANDROID_CLIENT_REQUIRED_CAPABILITIES = Object.freeze(["native-enrollment-attempt-v1", "native-enrollment-outcome-v1", "native-oidc-return-v1", "audio-webm-live-v1", "android-upgrade-policy-v1", "native-agency-handoff-v1", "android-upgrade-gate-v1", "personal-session-continuation-v1"]);
export function isAndroidApiProtocolCompatible(range, serverProtocol) {
  return Number.isSafeInteger(range?.minimum) && Number.isSafeInteger(range?.maximum) && range.minimum > 0 &&
    range.maximum >= range.minimum && Number.isSafeInteger(serverProtocol) && serverProtocol >= range.minimum && serverProtocol <= range.maximum;
}
