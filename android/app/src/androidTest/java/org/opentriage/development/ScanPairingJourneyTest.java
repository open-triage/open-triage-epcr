package org.opentriage.development;

import static org.junit.Assert.*;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasComponent;
import android.Manifest;
import android.app.Activity;
import android.app.Instrumentation.ActivityResult;
import android.content.Intent;
import androidx.test.espresso.intent.Intents;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.After;
import org.junit.Before;

/** Same real API enrollment journey, entering through the real permission/plugin result boundary. */
public class ScanPairingJourneyTest extends PairingJourneyTest {
    private boolean prepared;
    @Before public void initializeIntents() { Intents.init(); }
    @After public void releaseIntents() { Intents.release(); }
    private void response(ActivityResult result) {
        Intents.release(); Intents.init();
        intending(hasComponent(PairingScannerActivity.class.getName())).respondWith(result);
    }
    private void scan() throws Exception { evaluate("document.querySelector('[data-pairing-scan]').click()"); }
    private void permissionDenialAndCancellation() throws Exception {
        scan();
        var denied = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            Until.findObject(By.res(Pattern.compile(".*:id/permission_deny_button"))), 15000);
        assertNotNull("Fresh scanner must request camera permission", denied); denied.click();
        waitFor("document.querySelector('[role=alert]') && !document.querySelector('input[type=file]').disabled");
        assertEquals("Permission denial must preserve import", "true", evaluate("Boolean(document.querySelector('input[type=file]'))"));
        assertEquals("null", evaluate("document.querySelector('input[type=checkbox]')"));
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission("org.opentriage.development", Manifest.permission.CAMERA);
        // Launch the real camera activity and cancel it before substituting any frame result.
        scan();
        var cancel = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).wait(
            Until.findObject(By.res("org.opentriage.development", "pairing_scan_cancel")), 15000);
        assertNotNull("Camera scanner must expose its localized Cancel action", cancel); cancel.click();
        waitFor("!document.querySelector('input[type=file]').disabled && !document.querySelector('[role=alert]')");
        response(new ActivityResult(Activity.RESULT_CANCELED, null)); scan();
        waitFor("!document.querySelector('input[type=file]').disabled && !document.querySelector('[role=alert]')");
        assertEquals("Cancellation must not confirm enrollment", "null", evaluate("document.querySelector('input[type=checkbox]')"));
    }
    private String decode(String artifact) throws Exception {
        // Feed actual QR pixels through the camera's decoder. Only the camera frame source is substituted.
        BitMatrix matrix = new MultiFormatWriter().encode(artifact, BarcodeFormat.QR_CODE, 512, 512,
            Map.of(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M, EncodeHintType.CHARACTER_SET, "UTF-8", EncodeHintType.MARGIN, 4));
        int[] pixels = new int[matrix.getWidth() * matrix.getHeight()];
        for (int y = 0; y < matrix.getHeight(); y++) for (int x = 0; x < matrix.getWidth(); x++) pixels[y * matrix.getWidth() + x] = matrix.get(x, y) ? 0xff000000 : 0xffffffff;
        return PairingQrDecoder.reader(null).decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(matrix.getWidth(), matrix.getHeight(), pixels)))).getText();
    }
    @Override protected void importFile(String artifact) throws Exception {
        if (!prepared) { permissionDenialAndCancellation(); prepared = true; }
        String decoded = decode(artifact);
        response(new ActivityResult(Activity.RESULT_OK, new Intent().putExtra(PairingScannerActivity.PAYLOAD, decoded)));
        scan();
    }
}
