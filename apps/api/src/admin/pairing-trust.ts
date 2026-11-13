import { X509Certificate } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { ServiceUnavailableException } from "@nestjs/common";

/** Operator-provisioned public roots, never certificates fetched from an untrusted peer. */
export function pairingCaPem(environment: NodeJS.ProcessEnv = process.env, now = Date.now()): string {
  const file = environment.PAIRING_CA_FILE;
  if (!file) return ""; // Android's platform trust store covers public HTTPS.
  try {
    const descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    let pem: string;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 48000) throw new Error();
      pem = readFileSync(descriptor, "utf8");
    } finally { closeSync(descriptor); }
    if (Buffer.byteLength(pem, "utf8") > 48000) throw new Error();
    const pattern = /-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g;
    const blocks = pem.match(pattern) ?? [];
    if (!blocks.length || blocks.length > 16 || pem.replace(pattern, "").trim()) throw new Error();
    for (const block of blocks) {
      const certificate = new X509Certificate(block);
      if (!certificate.ca || Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new Error();
    }
    return pem;
  } catch {
    throw new ServiceUnavailableException("Pairing trust configuration is unavailable");
  }
}
