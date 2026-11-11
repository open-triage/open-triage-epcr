package org.opentriage.development;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "OpenTriageScanner", permissions = @Permission(alias = "camera", strings = Manifest.permission.CAMERA))
public class OpenTriageScannerPlugin extends Plugin {
    private boolean scanning;
    @PluginMethod public void scan(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String url = getBridge().getWebView().getUrl();
            if (url == null || !url.startsWith("https://localhost/")) { call.reject("Unapproved UI origin", "SCANNER_FAILED"); return; }
            if (scanning) { call.reject("Scanner already active", "SCANNER_FAILED"); return; }
            scanning = true;
            if (getPermissionState("camera") != PermissionState.GRANTED) requestPermissionForAlias("camera", call, "cameraPermission");
            else openScanner(call);
        });
    }
    @PermissionCallback private void cameraPermission(PluginCall call) {
        if (call == null) { scanning = false; return; }
        if (getPermissionState("camera") == PermissionState.GRANTED) openScanner(call);
        else { scanning = false; call.reject("Camera permission denied", "CAMERA_DENIED"); }
    }
    private void openScanner(PluginCall call) {
        try { startActivityForResult(call, new Intent(getContext(), PairingScannerActivity.class), "scanned"); }
        catch (Exception error) { scanning = false; call.reject("Scanner unavailable", "SCANNER_FAILED"); }
    }
    @ActivityCallback private void scanned(PluginCall call, ActivityResult result) {
        scanning = false;
        if (call == null) return; // A lost activity never confirms or consumes enrollment.
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            String code = data == null ? null : data.getStringExtra(PairingScannerActivity.ERROR);
            call.reject("Scanner unavailable", "QR_TOO_LARGE".equals(code) ? code : "SCANNER_FAILED"); return;
        }
        try {
            String artifact = PairingQrDecoder.accept(data.getStringExtra(PairingScannerActivity.PAYLOAD));
            JSObject value = new JSObject(); value.put("cancelled", false); value.put("artifact", artifact); call.resolve(value);
        } catch (Exception error) {
            call.reject("Invalid pairing QR", "QR_TOO_LARGE".equals(error.getMessage()) ? "QR_TOO_LARGE" : "INVALID_QR");
        }
    }
}
