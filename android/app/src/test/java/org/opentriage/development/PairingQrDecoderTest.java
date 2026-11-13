package org.opentriage.development;

import static org.junit.Assert.*;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.EnumMap;
import java.util.ArrayList;
import org.json.JSONObject;
import org.junit.Test;

public class PairingQrDecoderTest {
    private String artifact() throws Exception {
        String ca = new String(getClass().getResourceAsStream("/tls/ca.pem").readAllBytes(), StandardCharsets.UTF_8);
        return new JSONObject().put("version", 1).put("origin", "https://agency.example.test")
            .put("token", "a".repeat(43)).put("expiresAt", Instant.now().plusSeconds(240).toString()).put("caPem", ca).toString();
    }
    private BinaryBitmap image(String text, BarcodeFormat format) throws Exception {
        return image(text, format, 512, -1);
    }
    private BinaryBitmap image(String text, BarcodeFormat format, int size, int mask) throws Exception {
        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M); hints.put(EncodeHintType.CHARACTER_SET, "UTF-8"); hints.put(EncodeHintType.MARGIN, 4);
        if (mask >= 0) hints.put(EncodeHintType.QR_MASK_PATTERN, mask);
        BitMatrix matrix = new MultiFormatWriter().encode(text, format, size, size, hints);
        int[] pixels = new int[matrix.getWidth() * matrix.getHeight()];
        for (int y = 0; y < matrix.getHeight(); y++) for (int x = 0; x < matrix.getWidth(); x++) pixels[y * matrix.getWidth() + x] = matrix.get(x, y) ? 0xff000000 : 0xffffffff;
        return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(matrix.getWidth(), matrix.getHeight(), pixels)));
    }
    @Test public void cameraDecoderReadsVariedPairingDataAtEveryQrMaskAndPracticalImageScale() throws Exception {
        var payloads = new ArrayList<String>(); payloads.add("{broken"); payloads.add("https://agency.example.test/enroll/#code=" + "a".repeat(43));
        for (int seed = 0; seed < 4; seed++) {
            String token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(("synthetic-token-" + seed).getBytes(StandardCharsets.UTF_8)));
            payloads.add(new JSONObject(artifact()).put("token", token).put("origin", "https://agency-" + seed + ".example.test").toString());
        }
        String vectors = new String(getClass().getResourceAsStream("/compact-pairing-qr-vectors.json").readAllBytes(), StandardCharsets.UTF_8);
        var compact = new JSONObject(vectors).getJSONArray("vectors");
        for (int i = 0; i < compact.length(); i++) payloads.add(compact.getJSONObject(i).getString("compact"));
        String full = artifact(); payloads.add(full + " ".repeat(PairingQrDecoder.MAX_BYTES - full.getBytes(StandardCharsets.UTF_8).length));
        for (int payload = 0; payload < payloads.size(); payload++) for (int mask = 0; mask < 8; mask++) for (int size : new int[]{384, 512, 768}) {
            try { assertEquals(payloads.get(payload), PairingQrDecoder.reader(null).decode(image(payloads.get(payload), BarcodeFormat.QR_CODE, size, mask)).getText()); }
            catch (Exception failure) { throw new AssertionError("QR detection failed: payload=" + payload + " mask=" + mask + " size=" + size, failure); }
        }
    }
    @Test public void fullPrivateCaPairingIsDecodedFromAnActualQrImage() throws Exception {
        String encoded = artifact();
        assertTrue(encoded.getBytes(StandardCharsets.UTF_8).length < PairingQrDecoder.MAX_BYTES);
        String decoded = PairingQrDecoder.reader(null).decode(image(encoded, BarcodeFormat.QR_CODE)).getText();
        assertEquals(encoded, PairingQrDecoder.accept(decoded));
        assertEquals(new JSONObject(encoded).getString("token"), new JSONObject(decoded).getString("token"));
    }
    @Test public void independentTrustMaterialAndTokensRemainDetectable() throws Exception {
        for (int seed = 0; seed < 256; seed++) {
            String encoded = entropyArtifact(seed);
            try { assertEquals(encoded, PairingQrDecoder.reader(null).decode(image(encoded, BarcodeFormat.QR_CODE)).getText()); }
            catch (Exception failure) { throw new AssertionError("Independent QR detection failed at deterministic seed " + seed, failure); }
        }
    }
    private String entropyArtifact(int seed) throws Exception {
        // The detector treats trust text as opaque bytes; no synthetic certificate is used to establish TLS.
        var random = new java.util.Random(seed); byte[] bytes = new byte[800]; random.nextBytes(bytes);
        String ca = "-----BEGIN CERTIFICATE-----\n" + java.util.Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(bytes) + "\n-----END CERTIFICATE-----\n";
        String token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(("synthetic-token-" + seed).getBytes(StandardCharsets.UTF_8)));
        return "{\"version\":1,\"token\":" + JSONObject.quote(token) + ",\"origin\":\"https://10.0.2.2:9443\",\"expiresAt\":\"2030-01-01T00:00:00.000Z\",\"caPem\":" + JSONObject.quote(ca) + "}";
    }
    @Test public void realCameraDecoderHandlesCroppedNonSquareYuvFramesInEveryOrientation() throws Exception {
        String encoded = entropyArtifact(21);
        BitMatrix qr = new MultiFormatWriter().encode(encoded, BarcodeFormat.QR_CODE, 512, 512,
            Map.of(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M, EncodeHintType.CHARACTER_SET, "UTF-8", EncodeHintType.MARGIN, 4));
        for (int turn = 0; turn < 4; turn++) {
            byte[] frame = new byte[640 * 576]; java.util.Arrays.fill(frame, (byte) 255);
            for (int y = 0; y < 512; y++) for (int x = 0; x < 512; x++) {
                int originalX = switch (turn) { case 1 -> y; case 2 -> 511 - x; case 3 -> 511 - y; default -> x; };
                int originalY = switch (turn) { case 1 -> 511 - x; case 2 -> 511 - y; case 3 -> x; default -> y; };
                frame[(y + 32) * 640 + x + 64] = qr.get(originalX, originalY) ? 0 : (byte) 255;
            }
            var source = new PlanarYUVLuminanceSource(frame, 640, 576, 32, 16, 576, 544, false);
            assertFalse("Exercise camera sources without built-in rotation", source.isRotateSupported());
            var decoded = PairingQrDecoder.cameraDecoder(null).decode(source);
            assertNotNull("Cropped camera frame orientation " + turn, decoded); assertEquals(encoded, decoded.getText());
        }
        byte[] blank = new byte[640 * 576]; java.util.Arrays.fill(blank, (byte) 255);
        assertNull(PairingQrDecoder.cameraDecoder(null).decode(new PlanarYUVLuminanceSource(blank, 640, 576, 32, 16, 576, 544, false)));
    }
    @Test public void scannerRejectsOtherBarcodeFormatsAndUnrelatedOrExpiredPayloads() throws Exception {
        assertThrows(NotFoundException.class, () -> PairingQrDecoder.reader(null).decode(image("123456789012", BarcodeFormat.CODE_128)));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept("https://agency.example.test/enroll/#code=" + "a".repeat(43)));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept("{broken"));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(null));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(new JSONObject(artifact()).put("expiresAt", "2000-01-01T00:00:00Z").toString()));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(new JSONObject(artifact()).put("privateKey", "secret").toString()));
    }
    @Test public void qrBoundCountsUtf8BytesAndLeavesLargerMaterialForImport() throws Exception {
        String encoded = artifact();
        String atLimit = encoded + " ".repeat(PairingQrDecoder.MAX_BYTES - encoded.getBytes(StandardCharsets.UTF_8).length);
        assertEquals(atLimit, PairingQrDecoder.accept(atLimit));
        assertThrows(IllegalArgumentException.class, () -> PairingQrDecoder.accept(atLimit + " "));
        assertThrows(IllegalArgumentException.class, () -> PairingQrDecoder.accept("å".repeat(PairingQrDecoder.MAX_BYTES / 2 + 1)));
    }
}
