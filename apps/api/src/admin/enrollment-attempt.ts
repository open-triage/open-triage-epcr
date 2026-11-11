import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Native journal secret never appears in URLs or browser-visible results. */
export const enrollmentDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export function sameEnrollmentDigest(left: unknown, right: string): boolean {
  return typeof left === "string" && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
export function enrollmentAttemptBinding(origin: string, token: string, name: string, reassign: boolean, originalCredential: string) {
  // A tuple is unambiguous even if a name contains delimiters or non-ASCII text.
  return JSON.stringify(["open-triage.native-enrollment.v1", origin, token, name, reassign, originalCredential]);
}
export function enrollmentAttemptCredential(attempt: string, binding: string): string {
  return createHmac("sha256", Buffer.from(attempt, "base64url")).update(binding).digest("base64url");
}
