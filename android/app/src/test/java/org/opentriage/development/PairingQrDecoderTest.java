package org.opentriage.development;

import static org.junit.Assert.*;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.NotFoundException;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

public class PairingQrDecoderTest {
    private String artifact() throws Exception {
        String ca = new String(getClass().getResourceAsStream("/tls/ca.pem").readAllBytes(), StandardCharsets.UTF_8);
        return new JSONObject().put("version", 1).put("origin", "https://agency.example.test")
            .put("token", "a".repeat(43)).put("expiresAt", Instant.now().plusSeconds(240).toString()).put("caPem", ca).toString();
    }
    private BinaryBitmap image(String text, BarcodeFormat format) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(text, format, 512, 512,
            Map.of(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M, EncodeHintType.CHARACTER_SET, "UTF-8", EncodeHintType.MARGIN, 4));
        int[] pixels = new int[matrix.getWidth() * matrix.getHeight()];
        for (int y = 0; y < matrix.getHeight(); y++) for (int x = 0; x < matrix.getWidth(); x++) pixels[y * matrix.getWidth() + x] = matrix.get(x, y) ? 0xff000000 : 0xffffffff;
        return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(matrix.getWidth(), matrix.getHeight(), pixels)));
    }
    @Test public void fullPrivateCaPairingIsDecodedFromAnActualQrImage() throws Exception {
        String encoded = artifact();
        assertTrue(encoded.getBytes(StandardCharsets.UTF_8).length < PairingQrDecoder.MAX_BYTES);
        String decoded = PairingQrDecoder.reader(null).decodeWithState(image(encoded, BarcodeFormat.QR_CODE)).getText();
        assertEquals(encoded, PairingQrDecoder.accept(decoded));
        assertEquals(new JSONObject(encoded).getString("token"), new JSONObject(decoded).getString("token"));
    }
    @Test public void scannerRejectsOtherBarcodeFormatsAndUnrelatedOrExpiredPayloads() throws Exception {
        assertThrows(NotFoundException.class, () -> PairingQrDecoder.reader(null).decodeWithState(image("123456789012", BarcodeFormat.CODE_128)));
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
