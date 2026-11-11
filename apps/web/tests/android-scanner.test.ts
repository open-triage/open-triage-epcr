import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { createAndroidPairing, parseAndroidPairing } from "../app/android-pairing";
import { MAX_PAIRING_QR_BYTES, parseAndroidPairingQr, scannerFailureMessage } from "../app/android-scanner";

const issued = () => ({ origin: "https://agency.example.test", token: "a".repeat(43), expiresAt: new Date(Date.now() + 240000).toISOString() });
test("Android QR carries the same public CA, destination and authorization as import within a practical QR bound", () => {
  const ca = readFileSync(new URL("../../../android/app/src/test/resources/tls/ca.pem", import.meta.url), "utf8");
  const artifact = createAndroidPairing(issued(), ca);
  assert.deepEqual(parseAndroidPairingQr(artifact), parseAndroidPairing(artifact));
  const image = QRCode.create(artifact, { errorCorrectionLevel: "M" });
  assert(image.version <= 40);
  assert(new TextEncoder().encode(artifact).length <= MAX_PAIRING_QR_BYTES);
});
test("scan rejects expired, unrelated and oversized payloads without removing same-device import", () => {
  const artifact = createAndroidPairing(issued(), "");
  assert.throws(() => parseAndroidPairingQr(JSON.stringify({ ...JSON.parse(artifact), expiresAt: new Date(0).toISOString() })), { code: "INVALID_QR" });
  assert.throws(() => parseAndroidPairingQr("https://agency.example.test/enroll/#code=unrelated"), { code: "INVALID_QR" });
  const larger = artifact + " ".repeat(MAX_PAIRING_QR_BYTES);
  assert.throws(() => parseAndroidPairingQr(larger), { code: "QR_TOO_LARGE" });
  assert.deepEqual(parseAndroidPairing(larger), parseAndroidPairing(artifact));
  assert.throws(() => parseAndroidPairingQr("å".repeat(1025)), { code: "QR_TOO_LARGE" });
});
test("scanner outcomes map to localized permission, retry, trust and size states", () => {
  for (const [code, message] of Object.entries({ CAMERA_DENIED: "android.cameraDenied", QR_TOO_LARGE: "android.qrTooLarge", INVALID_QR: "android.invalidQr", CONNECTION_FAILED: "android.pairingFailed", SCANNER_FAILED: "android.scannerFailed" })) assert.equal(scannerFailureMessage({ code }), message);
});
