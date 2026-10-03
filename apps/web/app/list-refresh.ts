import { PlatformRequestError } from "./platform-errors";

/** Retain loaded rows on transient errors, but clear data when access is revoked. */
export function listAccessRemoved(cause: unknown): boolean {
  const status = cause instanceof PlatformRequestError ? cause.status
    : cause instanceof Error ? Number(cause.message) : NaN;
  return [401, 403, 404, 410].includes(status);
}
