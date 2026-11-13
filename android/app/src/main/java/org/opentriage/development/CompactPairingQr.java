package org.opentriage.development;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.zip.Inflater;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded transport envelope; certificate, expiry and token validation remains unchanged. */
final class CompactPairingQr {
    private static final String ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    static String expand(String text) throws Exception {
        if (!text.startsWith("OTQ1:")) return text;
        if (text.length() > 2048) throw new IllegalArgumentException("QR_TOO_LARGE");
        String encoded = text.substring(5);
        if (encoded.isEmpty() || encoded.length() % 3 == 1) throw new IllegalArgumentException("Invalid compact QR");
        ByteArrayOutputStream compressed = new ByteArrayOutputStream();
        for (int i = 0; i < encoded.length(); i += 3) {
            int count = Math.min(3, encoded.length() - i), value = 0, multiplier = 1;
            for (int j = 0; j < count; j++) {
                int digit = ALPHABET.indexOf(encoded.charAt(i + j));
                if (digit < 0) throw new IllegalArgumentException("Invalid compact QR");
                value += digit * multiplier; multiplier *= 45;
            }
            if (value > (count == 3 ? 65535 : 255)) throw new IllegalArgumentException("Invalid compact QR");
            if (count == 3) compressed.write(value / 256);
            compressed.write(value % 256);
        }
        Inflater inflater = new Inflater();
        try {
            inflater.setInput(compressed.toByteArray());
            ByteArrayOutputStream plain = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            while (!inflater.finished()) {
                int count = inflater.inflate(buffer);
                if (plain.size() + count > 65536) throw new IllegalArgumentException("Oversized artifact");
                plain.write(buffer, 0, count);
                if (count == 0 && !inflater.finished()) throw new IllegalArgumentException("Invalid compact QR");
            }
            if (inflater.getRemaining() != 0) throw new IllegalArgumentException("Trailing compact QR data");
            String decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(plain.toByteArray())).toString();
            JSONArray tuple = new JSONArray(decoded);
            if (tuple.length() != 4) throw new IllegalArgumentException("Invalid compact QR");
            for (int i = 0; i < 4; i++) if (!(tuple.get(i) instanceof String)) throw new IllegalArgumentException("Invalid compact QR");
            return new JSONObject().put("version", 1).put("origin", tuple.getString(0))
                .put("token", tuple.getString(1)).put("expiresAt", tuple.getString(2)).put("caPem", tuple.getString(3)).toString();
        } finally { inflater.end(); }
    }
}
