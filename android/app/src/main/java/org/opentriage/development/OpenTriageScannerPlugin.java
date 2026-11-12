package org.opentriage.development;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "OpenTriageScanner", permissions = @Permission(alias = "camera", strings = Manifest.permission.CAMERA))
public class OpenTriageScannerPlugin extends LifecycleBoundPlugin {
    private boolean scanning;
    @PluginMethod public void scan(PluginCall call) {
        withReplyRealm(call, () -> {
            String url = getBridge().getWebView().getUrl();
            if (url == null || !url.startsWith("https://localhost/")) { rejectCall(call, "Unapproved UI origin", "SCANNER_FAILED"); return; }
            if (scanning) { rejectCall(call, "Scanner already active", "SCANNER_FAILED"); return; }
            scanning = true;
            if (getPermissionState("camera") != PermissionState.GRANTED) requestPermissionForAlias("camera", call, "cameraPermission");
            else openScanner(call);
        });
    }
    @PermissionCallback private void cameraPermission(PluginCall call) {
        if (call == null) { scanning = false; return; }
        withReplyRealm(call, () -> {
            if (getPermissionState("camera") == PermissionState.GRANTED) openScanner(call);
            else { scanning = false; rejectCall(call, "Camera permission denied", "CAMERA_DENIED"); }
        });
    }
    private void openScanner(PluginCall call) {
        try { startActivityForResult(call, new Intent(getContext(), PairingScannerActivity.class), "scanned"); }
        catch (Exception error) { scanning = false; rejectCall(call, "Scanner unavailable", "SCANNER_FAILED"); }
    }
    @ActivityCallback private void scanned(PluginCall call, ActivityResult result) {
        scanning = false;
        if (call == null) return; // A lost activity never confirms or consumes enrollment.
        withReplyRealm(call, () -> {
            Intent data = result.getData();
            if (result.getResultCode() == Activity.RESULT_CANCELED) {
                JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); resolveCall(call, cancelled); return;
            }
            if (result.getResultCode() != Activity.RESULT_OK || data == null) {
                String code = data == null ? null : data.getStringExtra(PairingScannerActivity.ERROR);
                rejectCall(call, "Scanner unavailable", "QR_TOO_LARGE".equals(code) ? code : "SCANNER_FAILED"); return;
            }
            try {
                String artifact = PairingQrDecoder.accept(data.getStringExtra(PairingScannerActivity.PAYLOAD));
                JSObject value = new JSObject(); value.put("cancelled", false); value.put("artifact", artifact); resolveCall(call, value);
            } catch (Exception error) {
                rejectCall(call, "Invalid pairing QR", "QR_TOO_LARGE".equals(error.getMessage()) ? "QR_TOO_LARGE" : "INVALID_QR");
            }
        });
    }
}
