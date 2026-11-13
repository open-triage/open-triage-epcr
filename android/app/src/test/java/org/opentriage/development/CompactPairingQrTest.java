package org.opentriage.development;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.zip.DeflaterOutputStream;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class CompactPairingQrTest {
    private String envelope(byte[] bytes) {
        String alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
        StringBuilder result = new StringBuilder("OTQ1:");
        for (int i = 0; i < bytes.length; i += 2) {
            boolean pair = i + 1 < bytes.length;
            int value = (bytes[i] & 255) * (pair ? 256 : 1) + (pair ? bytes[i + 1] & 255 : 0);
            result.append(alphabet.charAt(value % 45)).append(alphabet.charAt(value / 45 % 45));
            if (pair) result.append(alphabet.charAt(value / 2025));
        }
        return result.toString();
    }
    private byte[] compressed(byte[] text) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (DeflaterOutputStream stream = new DeflaterOutputStream(output)) { stream.write(text); }
        return output.toByteArray();
    }
    private String encoded(String text) throws Exception { return envelope(compressed(text.getBytes(StandardCharsets.UTF_8))); }
    private JSONArray tuple() {
        return new JSONArray().put("https://agency.example.test").put("a".repeat(43))
            .put(Instant.now().plusSeconds(240).toString()).put("");
    }
    @Test public void browserVectorsRetainEveryFieldIncludingTheExactCa() throws Exception {
        String fixture = new String(getClass().getResourceAsStream("/compact-pairing-qr-vectors.json").readAllBytes(), StandardCharsets.UTF_8);
        JSONArray vectors = new JSONObject(fixture).getJSONArray("vectors");
        for (int i = 0; i < vectors.length(); i++) {
            JSONObject vector = vectors.getJSONObject(i), expected = new JSONObject(vector.getString("artifact"));
            String decoded = CompactPairingQr.expand(vector.getString("compact"));
            JSONObject actual = new JSONObject(decoded);
            assertEquals(expected.length(), actual.length());
            var keys = expected.keys();
            while (keys.hasNext()) { String key = keys.next(); assertEquals(expected.get(key), actual.get(key)); }
            long now = Instant.parse(expected.getString("expiresAt")).toEpochMilli() - 60000;
            assertEquals(expected.getString("token"), TrustedConnection.artifact(decoded, now).getString("token"));
        }
    }
    @Test public void compactScansRetainExpiryTokenAndClosedFieldValidation() throws Exception {
        JSONObject decoded = new JSONObject(PairingQrDecoder.accept(encoded(tuple().toString())));
        assertEquals("https://agency.example.test", decoded.getString("origin"));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(encoded(tuple().put(1, "forged").toString())));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(encoded(tuple().put(2, "2000-01-01T00:00:00Z").toString())));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(encoded(tuple().put("extra").toString())));
        assertThrows(Exception.class, () -> PairingQrDecoder.accept(encoded(tuple().put(3, true).toString())));
    }
    @Test public void rejectsBombsTruncationTrailingBytesInvalidUtf8AndBase45Overflow() throws Exception {
        assertThrows(Exception.class, () -> CompactPairingQr.expand(encoded("a".repeat(65537))));
        byte[] valid = compressed(tuple().toString().getBytes(StandardCharsets.UTF_8));
        assertThrows(Exception.class, () -> CompactPairingQr.expand(envelope(Arrays.copyOf(valid, valid.length - 1))));
        assertThrows(Exception.class, () -> CompactPairingQr.expand(envelope(Arrays.copyOf(valid, valid.length + 1))));
        assertThrows(Exception.class, () -> CompactPairingQr.expand(envelope(compressed(new byte[]{(byte) 0xff}))));
        for (String invalid : new String[]{"OTQ1:", "OTQ1:A", "OTQ1::: ", "OTQ1:ZZ", "OTQ1:abc", "OTQ1:" + "A".repeat(2048)}) {
            assertThrows(Exception.class, () -> CompactPairingQr.expand(invalid));
        }
    }
}
