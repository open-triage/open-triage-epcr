package org.opentriage.development;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** App-private encrypted connection/cookie state. Backup is disabled for the entire application. */
final class ConnectionVault {
    private static final String ALIAS = "open-triage.connection.v1";
    private final android.content.SharedPreferences preferences;
    ConnectionVault(Context context) { preferences = context.getSharedPreferences("connection-v1", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private JSONObject readJson(String slot) throws Exception {
        String encoded = preferences.getString(slot, null);
        if (encoded == null) return null;
        JSONObject envelope = new JSONObject(encoded);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
        cipher.updateAAD((slot.equals("encrypted") ? ALIAS : ALIAS + ":" + slot).getBytes(StandardCharsets.UTF_8));
        byte[] plain = cipher.doFinal(Base64.decode(envelope.getString("body"), Base64.NO_WRAP));
        return new JSONObject(new String(plain, StandardCharsets.UTF_8));
    }
    private void writeJson(String slot, JSONObject value) throws Exception {
        if (value == null) { if (!preferences.edit().remove(slot).commit()) throw new IllegalStateException("Storage unavailable"); return; }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD((slot.equals("encrypted") ? ALIAS : ALIAS + ":" + slot).getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("body", Base64.encodeToString(encrypted, Base64.NO_WRAP));
        if (!preferences.edit().putString(slot, envelope.toString()).commit()) throw new IllegalStateException("Connection storage unavailable");
    }
    TrustedConnection read() throws Exception { JSONObject value = readJson("encrypted"); return value == null ? null : TrustedConnection.restore(value); }
    void write(TrustedConnection connection) throws Exception { writeJson("encrypted", connection.saved()); }
    JSONObject pendingAuthentication() throws Exception { return readJson("oidc-return"); }
    void pendingAuthentication(JSONObject value) throws Exception { writeJson("oidc-return", value); }
}
