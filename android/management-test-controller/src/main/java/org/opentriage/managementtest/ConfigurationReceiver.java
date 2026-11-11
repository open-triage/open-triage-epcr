package org.opentriage.managementtest;

import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Test-only owner installed on a disposable emulator; never included in the clinical APK. */
public class ConfigurationReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            try {
                String certificate = intent.getStringExtra("caCertificateBase64");
                if (certificate != null) {
                    if (certificate.length() > 90000) throw new IllegalArgumentException();
                    byte[] bytes = Base64.decode(certificate, Base64.NO_WRAP);
                    DevicePolicyManager policy = context.getSystemService(DevicePolicyManager.class);
                    ComponentName admin = new ComponentName(context, AdminReceiver.class);
                    if (intent.getBooleanExtra("removeCertificate", false)) {
                        policy.uninstallCaCert(admin, bytes);
                        if (policy.hasCaCertInstalled(admin, bytes)) throw new IllegalStateException();
                    } else if (!policy.installCaCert(admin, bytes) || !policy.hasCaCertInstalled(admin, bytes)) throw new IllegalStateException();
                    result.setResultCode(0); return;
                }
                String encoded = intent.getStringExtra("configurationBase64");
                if (encoded == null || encoded.length() > 90000) throw new IllegalArgumentException();
                JSONObject input = new JSONObject(new String(Base64.decode(encoded, Base64.NO_WRAP), StandardCharsets.UTF_8));
                Bundle values = new Bundle();
                for (java.util.Iterator<String> keys = input.keys(); keys.hasNext();) {
                    String key = keys.next();
                    Object value = input.get(key);
                    if (value instanceof Boolean) values.putBoolean(key, (Boolean) value);
                    else if (value instanceof Integer) values.putInt(key, (Integer) value);
                    else if (value instanceof String) values.putString(key, (String) value);
                    else throw new IllegalArgumentException();
                }
                context.getSystemService(DevicePolicyManager.class).setApplicationRestrictions(
                    new ComponentName(context, AdminReceiver.class), "org.opentriage.development", values);
                result.setResultCode(0);
            } catch (Exception invalid) { result.setResultCode(1); }
            finally { result.finish(); }
        }, "managed-configuration-test").start();
    }
}
