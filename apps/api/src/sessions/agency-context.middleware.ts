import { agencyRequest, browserOrigin } from "./agency-context.js";
import { installationCredential } from "./installation-session.js";

/** Share the deployed request boundary with HTTP integration fixtures. */
export function agencyContextMiddleware(request: Parameters<typeof browserOrigin>[0],
  response: { status(code: number): { json(body: unknown): void } }, next: () => void): void {
  try {
    agencyRequest.run({ origin: browserOrigin(request), organizationId: request.headers["x-organization-id"],
      installationCredential: installationCredential(request.headers.cookie) }, next);
  } catch {
    response.status(400).json({ message: "A valid application origin is required" });
  }
}
