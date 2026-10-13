import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(version: string): Buffer {
  let keys: unknown;
  try { keys = JSON.parse(process.env.OIDC_CREDENTIAL_KEYS_JSON || "{}"); } catch { throw new Error("OIDC credential encryption is unavailable"); }
  const value = keys && typeof keys === "object" ? (keys as Record<string, unknown>)[version] : undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("OIDC credential encryption is unavailable");
  const result = Buffer.from(value, "base64");
  if (result.length !== 32) throw new Error("OIDC credential encryption is unavailable");
  return result;
}
export function encryptCredential(secret: string, groupId: string, providerId: string) {
  const version = process.env.OIDC_CREDENTIAL_KEY_VERSION || "1";
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(version), nonce);
  cipher.setAAD(Buffer.from(`oidc-client-secret:${groupId}:${providerId}:${version}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { version, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptCredential(envelope: ReturnType<typeof encryptCredential>, groupId: string, providerId: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key(envelope.version), Buffer.from(envelope.nonce, "base64"));
  decipher.setAAD(Buffer.from(`oidc-client-secret:${groupId}:${providerId}:${envelope.version}`));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
