import { MAX_PAIRING_EXPIRY_MINUTES } from "@open-triage/contracts";
/** Public setup material only. The code retains the server's selected single-use lifetime. */
export const MAX_PAIRING_BYTES = 65536;
export type AndroidPairing = Readonly<{ version: 1; origin: string; token: string; expiresAt: string; caPem: string }>;
export function parseAndroidPairing(encoded: string, now = Date.now()): AndroidPairing {
  if (new TextEncoder().encode(encoded).length > MAX_PAIRING_BYTES) throw new Error("Invalid pairing artifact");
  const value: unknown = JSON.parse(encoded);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pairing artifact");
  const b = value as Record<string, unknown>;
  if (Object.keys(b).sort().join(",") !== "caPem,expiresAt,origin,token,version" || b.version !== 1 ||
      typeof b.origin !== "string" || typeof b.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(b.token) ||
      typeof b.expiresAt !== "string" || !Number.isFinite(Date.parse(b.expiresAt)) || Date.parse(b.expiresAt) <= now ||
      Date.parse(b.expiresAt) > now + MAX_PAIRING_EXPIRY_MINUTES * 60 * 1000 + 30000 || typeof b.caPem !== "string") throw new Error("Invalid pairing artifact");
  const origin = new URL(b.origin);
  if (origin.protocol !== "https:" || origin.origin !== b.origin || origin.username || origin.password) throw new Error("Invalid pairing origin");
  if (b.caPem.length > 48000 || (b.caPem !== "" && !/^(?:\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*)+$/.test(b.caPem))) throw new Error("Invalid public CA certificates");
  return b as AndroidPairing;
}
export function createAndroidPairing(code: Omit<AndroidPairing, "version" | "caPem">, caPem: string): string {
  const encoded = JSON.stringify({ version: 1, ...code, caPem });
  parseAndroidPairing(encoded);
  return encoded;
}
