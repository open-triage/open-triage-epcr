import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { inflateSync } from "node:zlib";
import { compactAndroidPairingQr } from "../app/android-pairing-qr";
import { readFileSync } from "node:fs";
import { createAndroidPairing, parseAndroidPairing } from "../app/android-pairing";
import { MAX_PAIRING_QR_BYTES, parseAndroidPairingQr, scannerFailureMessage } from "../app/android-scanner";

const issued = () => ({ origin: "https://agency.example.test", token: "a".repeat(43), expiresAt: new Date(Date.now() + 240000).toISOString() });
test("compact pairing QR uses fewer modules while preserving every trust and enrollment byte", async () => {
  const ca = readFileSync(new URL("../../../android/app/src/test/resources/tls/ca.pem", import.meta.url), "utf8");
  for (const trust of ["", ca]) {
    const artifact = createAndroidPairing({...issued(),token:"xJEXWe9y7qix5b0mIcbIzC5ehCbbxwZLhMpV2bV3-aA"}, trust);
    const encoded = await compactAndroidPairingQr(artifact);
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    const bytes:number[] = [];
    for (let i=5; i<encoded.length; i+=3) {
      const count=Math.min(3,encoded.length-i);
      const value=[...encoded.slice(i,i+count)].reduce((sum,char,j)=>sum+alphabet.indexOf(char)*45**j,0);
      if(count===3)bytes.push(Math.floor(value/256));bytes.push(value%256);
    }
    const [origin,token,expiresAt,caPem] = JSON.parse(inflateSync(Buffer.from(bytes)).toString("utf8"));
    assert.deepEqual({version:1,origin,token,expiresAt,caPem}, JSON.parse(artifact));
    assert(QRCode.create(encoded,{errorCorrectionLevel:"M"}).version < QRCode.create(artifact,{errorCorrectionLevel:"M"}).version);
  }
});
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
