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
    TrustedConnection read() throws Exception {
        var saved = readJson("encrypted"); return saved == null || !saved.has("connection") && !saved.has("origin") ? null : TrustedConnection.restore(saved.has("connection") ? saved.getJSONObject("connection") : saved);
    }
    JSONObject pending() throws Exception { var saved = readJson("encrypted"); return saved == null ? null : saved.optJSONObject("enrollment"); }
    String legacyStorageScope() throws Exception {
        JSONObject state = readJson("encrypted");
        if (state == null) return null;
        // The authenticated pre-transition vault had exactly one possible server.
        if (state.has("origin")) return NativeConnectionIdentity.storageScope(TrustedConnection.restore(state).origin);
        if (!state.has("legacyStorageScope")) return null;
        String scope = state.getString("legacyStorageScope");
        if (!scope.matches("[A-Za-z0-9_-]{43}") || !java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(java.util.Base64.getUrlDecoder().decode(scope)).equals(scope)) throw new IllegalStateException("Invalid legacy storage proof");
        return scope;
    }
    void write(TrustedConnection connection) throws Exception { writeState(connection, pending()); }
    void stage(TrustedConnection connection, JSONObject enrollment) throws Exception { writeState(connection, enrollment); }
    void promote(TrustedConnection connection) throws Exception { writeState(connection, null); }
    JSONObject pendingHandoff() throws Exception { var saved = readJson("encrypted"); return saved == null ? null : saved.optJSONObject("handoff"); }
    void stageHandoff(TrustedConnection connection, JSONObject handoff) throws Exception { writeState(connection, pending(), handoff); }
    void promoteHandoff(TrustedConnection connection) throws Exception { writeState(connection, null, null); }
    JSONObject personalContinuation() throws Exception { var saved = readJson("encrypted"); return saved == null ? null : saved.optJSONObject("personalContinuation"); }
    void clearPersonalContinuation() throws Exception {
        var saved = readJson("encrypted");
        if (saved != null && saved.has("personalContinuation")) { saved.remove("personalContinuation"); writeJson("encrypted", saved); }
    }
    void savePersonalContinuation(TrustedConnection connection, JSONObject session) throws Exception {
        JSONObject continuation = NativePersonalContinuation.capture(connection, session);
        writeState(connection, pending(), pendingHandoff(), continuation);
    }
    void stageHandoffSession(TrustedConnection connection, JSONObject handoff, JSONObject session) throws Exception {
        writeState(connection, null, handoff, NativePersonalContinuation.capture(connection, session));
    }
    private void writeState(TrustedConnection connection, JSONObject enrollment) throws Exception { writeState(connection, enrollment, pendingHandoff()); }
    private void writeState(TrustedConnection connection, JSONObject enrollment, JSONObject handoff) throws Exception {
        JSONObject continuation = personalContinuation();
        if (!NativePersonalContinuation.matches(continuation, connection)) continuation = null;
        writeState(connection, enrollment, handoff, continuation);
    }
    private void writeState(TrustedConnection connection, JSONObject enrollment, JSONObject handoff, JSONObject continuation) throws Exception {
        JSONObject state = new JSONObject();
        String legacyScope = legacyStorageScope();
        if (legacyScope != null) state.put("legacyStorageScope", legacyScope);
        if (connection != null) state.put("connection", connection.saved());
        if (enrollment != null) state.put("enrollment", enrollment);
        if (handoff != null) state.put("handoff", handoff);
        if (continuation != null && enrollment == null) state.put("personalContinuation", continuation);
        writeJson("encrypted", state);
    }
    JSONObject pendingAuthentication() throws Exception { return readJson("oidc-return"); }
    void pendingAuthentication(JSONObject value) throws Exception { writeJson("oidc-return", value); }
}
