import { agencyRequest, browserOrigin } from "./agency-context.js";
import { installationCredential } from "./installation-session.js";

/** Android's immutable legacy HttpURLConnection transport uses RuntimeInit's
 * Dalvik agent. This is a conservative compatibility signal, never authority. */
export function legacyAndroidAgent(value: unknown): boolean {
  return typeof value === "string" && value.length <= 512 && /^Dalvik\/[0-9.]+ \(Linux; U; Android [^)\r\n]{1,450}\)$/.test(value);
}
/** Share the deployed request boundary with HTTP integration fixtures. */
export function agencyContextMiddleware(request: Parameters<typeof browserOrigin>[0],
  response: { status(code: number): { json(body: unknown): void } }, next: () => void): void {
  try {
    agencyRequest.run({ origin: browserOrigin(request), organizationId: request.headers["x-organization-id"],
      installationCredential: installationCredential(request.headers.cookie), androidVersion: request.headers["x-opentriage-android-version"], legacyAndroid: legacyAndroidAgent(request.headers["user-agent"]) }, next);
  } catch {
    response.status(400).json({ message: "A valid application origin is required" });
  }
}
