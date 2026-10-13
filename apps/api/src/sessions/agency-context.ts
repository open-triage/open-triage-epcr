import { AsyncLocalStorage } from "node:async_hooks";
import { BadRequestException } from "@nestjs/common";

export const agencyRequest = new AsyncLocalStorage<{ origin: string; organizationId?: string; installationCredential?: string }>();

/** Ignore forwarded-host headers: the configured edge must preserve Host. */
export function browserOrigin(request: { protocol?: string; headers: { origin?: string; host?: string; cookie?: string; "x-organization-id"?: string } }): string {
  const value = request.headers.origin ?? `${request.protocol ?? "http"}://${request.headers.host ?? ""}`;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin.toLowerCase();
  } catch { throw new BadRequestException("A valid application origin is required"); }
}
