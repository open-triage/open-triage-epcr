package org.opentriage.development;

import java.io.OutputStream;
import java.util.function.BooleanSupplier;

/** One explicit user-selected export; failures cancel the partial destination. */
final class NativePdfExport {
    interface Loader { byte[] load() throws Exception; }
    interface Validator { void validate(byte[] bytes) throws Exception; }
    interface Destination { OutputStream open() throws Exception; void delete() throws Exception; }
    static void write(Loader fresh, Validator validate, BooleanSupplier current, Destination destination) throws Exception {
        byte[] bytes = null; boolean completed = false;Throwable primary = null;
        try {
            require(current); bytes = fresh.load(); require(current);
            if (bytes == null || bytes.length > NativePdfContract.MAX_BYTES) throw new IllegalStateException("PDF bound");
            validate.validate(bytes); require(current);
            try (OutputStream output = destination.open()) {
                if (output == null) throw new IllegalStateException("Destination unavailable");
                for (int offset = 0; offset < bytes.length; offset += 32768) {
                    require(current); output.write(bytes, offset, Math.min(32768, bytes.length - offset));
                }
                output.flush(); require(current);
            }
            require(current); completed = true;
        } catch(Exception|Error failure) {primary=failure;throw failure;
        } finally {
            if (bytes != null) java.util.Arrays.fill(bytes, (byte) 0);
            if (!completed) try { destination.delete(); } catch (Exception cleanup) {
                if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;
            }
        }
    }
    private static void require(BooleanSupplier current) { if (!current.getAsBoolean()) throw new IllegalStateException("PDF authority ended"); }
}
