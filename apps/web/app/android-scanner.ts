import { registerPlugin } from "@capacitor/core";
import { parseAndroidPairing, type AndroidPairing } from "./android-pairing";

/** QR 40-M permits 2,331 byte-mode bytes. Leave space for reliable camera decoding. */
export const MAX_PAIRING_QR_BYTES = 2048;
export type PairingScanResult = { cancelled: true } | { cancelled: false; artifact: string };
export const AndroidScanner = registerPlugin<{ scan(): Promise<PairingScanResult> }>("OpenTriageScanner");
export class PairingQrError extends Error {
  constructor(readonly code: "QR_TOO_LARGE" | "INVALID_QR") { super(code); }
}
export function parseAndroidPairingQr(encoded: string, now = Date.now()): AndroidPairing {
  if (new TextEncoder().encode(encoded).length > MAX_PAIRING_QR_BYTES) throw new PairingQrError("QR_TOO_LARGE");
  try { return parseAndroidPairing(encoded, now); }
  catch { throw new PairingQrError("INVALID_QR"); }
}
export function scannerFailureMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "CAMERA_DENIED") return "android.cameraDenied";
  if (code === "QR_TOO_LARGE") return "android.qrTooLarge";
  if (code === "INVALID_QR") return "android.invalidQr";
  if (code === "CONNECTION_FAILED") return "android.pairingFailed";
  if (code === "TLS_FAILED") return "android.tlsFailed";
  return "android.scannerFailed";
}
