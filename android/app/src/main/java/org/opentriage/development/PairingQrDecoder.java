package org.opentriage.development;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import java.nio.charset.StandardCharsets;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** The camera and image regression tests use the same QR-only decoder configuration. */
final class PairingQrDecoder {
    static final int MAX_BYTES = 2048;
    static MultiFormatReader reader(Map<DecodeHintType, ?> inheritedHints) {
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        if (inheritedHints != null) hints.putAll(inheritedHints);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, List.of(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        MultiFormatReader reader = new MultiFormatReader(); reader.setHints(hints); return reader;
    }
    static String accept(String text) throws Exception {
        if (text == null) throw new IllegalArgumentException("INVALID_QR");
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("QR_TOO_LARGE");
        TrustedConnection.artifact(text, System.currentTimeMillis());
        return text;
    }
}
