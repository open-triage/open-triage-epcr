/** Advance only for a breaking change to the generic Android API contract.
 * Compatible server deployments retain this protocol independently of Git SHA.
 */
export const ANDROID_API_PROTOCOL_VERSION = 1;
export const ANDROID_CLIENT_API_PROTOCOL_RANGE = Object.freeze({ minimum: 1, maximum: 1 });
export function isAndroidApiProtocolCompatible(range, serverProtocol) {
  return Number.isSafeInteger(range?.minimum) && Number.isSafeInteger(range?.maximum) && range.minimum > 0 &&
    range.maximum >= range.minimum && Number.isSafeInteger(serverProtocol) && serverProtocol >= range.minimum && serverProtocol <= range.maximum;
}
