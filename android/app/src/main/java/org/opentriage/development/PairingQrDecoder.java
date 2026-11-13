package org.opentriage.development;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.LuminanceSource;
import com.google.zxing.NotFoundException;
import com.google.zxing.Reader;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import com.journeyapps.barcodescanner.Decoder;
import java.nio.charset.StandardCharsets;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** The camera and image regression tests use the same QR-only decoder configuration. */
final class PairingQrDecoder {
    static final int MAX_BYTES = 2048;
    static Reader reader(Map<DecodeHintType, ?> inheritedHints) {
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        if (inheritedHints != null) hints.putAll(inheritedHints);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, List.of(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        MultiFormatReader delegate = new MultiFormatReader(); delegate.setHints(hints);
        return new Reader() {
            @Override public Result decode(BinaryBitmap image) throws NotFoundException { return decode(image, null); }
            @Override public Result decode(BinaryBitmap image, Map<DecodeHintType, ?> suppliedHints) throws NotFoundException {
                // Finder search can miss a valid dense QR in one orientation. Rotate actual luminance,
                // retaining ordinary finder detection and error correction for every attempt.
                BinaryBitmap current = image;
                for (int turn = 0; turn < 4; turn++) {
                    try { return delegate.decodeWithState(current); }
                    catch (NotFoundException missing) {
                        if (turn == 3 || !current.isRotateSupported()) throw missing;
                        current = current.rotateCounterClockwise();
                    } finally { delegate.reset(); }
                }
                throw NotFoundException.getNotFoundInstance();
            }
            @Override public void reset() { delegate.reset(); }
        };
    }
    static Decoder cameraDecoder(Map<DecodeHintType, ?> hints) {
        return new Decoder(reader(hints)) {
            @Override protected BinaryBitmap toBitmap(LuminanceSource source) {
                // Camera YUV sources do not implement rotation; preserve their cropped grayscale pixels.
                return new BinaryBitmap(new HybridBinarizer(new RotatableLuminance(source)));
            }
        };
    }
    private static final class RotatableLuminance extends LuminanceSource {
        private final byte[] pixels;
        RotatableLuminance(LuminanceSource source) {
            super(source.getWidth(), source.getHeight());
            byte[] original = source.getMatrix(); int size = Math.multiplyExact(getWidth(), getHeight());
            if (original.length < size) throw new IllegalArgumentException("Invalid camera frame");
            pixels = java.util.Arrays.copyOf(original, size);
        }
        private RotatableLuminance(int width, int height, byte[] pixels) { super(width, height); this.pixels = pixels; }
        @Override public byte[] getRow(int y, byte[] row) {
            if (y < 0 || y >= getHeight()) throw new IllegalArgumentException("Invalid frame row");
            if (row == null || row.length < getWidth()) row = new byte[getWidth()];
            System.arraycopy(pixels, y * getWidth(), row, 0, getWidth()); return row;
        }
        @Override public byte[] getMatrix() { return pixels; }
        @Override public boolean isRotateSupported() { return true; }
        @Override public LuminanceSource rotateCounterClockwise() {
            int width = getWidth(), height = getHeight(); byte[] rotated = new byte[pixels.length];
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) rotated[(width - 1 - x) * height + y] = pixels[y * width + x];
            return new RotatableLuminance(height, width, rotated);
        }
    }
    static String accept(String text) throws Exception {
        if (text == null) throw new IllegalArgumentException("INVALID_QR");
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("QR_TOO_LARGE");
        String artifact = CompactPairingQr.expand(text);
        TrustedConnection.artifact(artifact, System.currentTimeMillis());
        return artifact;
    }
}
