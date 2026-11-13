import { MAX_PAIRING_QR_BYTES, PairingQrError, parseAndroidPairingQr } from "./android-scanner";

// Alphanumeric QR mode uses fewer modules than byte-mode base64. The compressed
// envelope changes transport only; the full original artifact is validated after decoding.
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
export async function compactAndroidPairingQr(artifact: string): Promise<string> {
  const pairing = parseAndroidPairingQr(artifact);
  const tuple = JSON.stringify([pairing.origin, pairing.token, pairing.expiresAt, pairing.caPem]);
  const stream = new Blob([tuple]).stream().pipeThrough(new CompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let encoded = "OTQ1:";
  for (let i = 0; i < bytes.length; i += 2) {
    const value = bytes[i]! * (i + 1 < bytes.length ? 256 : 1) + (bytes[i + 1] ?? 0);
    encoded += alphabet[value % 45]! + alphabet[Math.floor(value / 45) % 45]!;
    if (i + 1 < bytes.length) encoded += alphabet[Math.floor(value / 2025)]!;
  }
  if (encoded.length > MAX_PAIRING_QR_BYTES) throw new PairingQrError("QR_TOO_LARGE");
  return encoded;
}
