package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;

public class NativeInstallationStatusTest {
    @Test public void onlyAnExplicitSuccessfulAssessmentWithdrawsPairing() throws Exception {
        assertTrue(NativeInstallationStatus.requiresPairing(200, "{\"enrolled\":false}"));
        for (int status : new int[]{401, 403, 404, 500, 503}) {
            assertFalse(NativeInstallationStatus.requiresPairing(status, "{\"enrolled\":false}"));
        }
        for (String body : new String[]{"{}", "{\"enrolled\":true}", "{\"enrolled\":null}", "{\"enrolled\":\"false\"}"}) {
            assertFalse(NativeInstallationStatus.requiresPairing(200, body));
        }
        assertThrows(Exception.class, () -> NativeInstallationStatus.requiresPairing(200, "invalid"));
    }
}
