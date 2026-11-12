package org.opentriage.development;
import static org.junit.Assert.*;
import android.content.Context;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import org.json.JSONObject;
import org.junit.Test;

/** Actual Android Keystore encryption: legacy provenance cannot be guessed from a new connection. */
public class LegacyConnectionVaultTest {
    private static final String ALIAS="open-triage.connection.v1";
    private String encrypted(ConnectionVault vault, JSONObject plain) throws Exception {
        var key=ConnectionVault.class.getDeclaredMethod("key");key.setAccessible(true);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,(SecretKey)key.invoke(vault));
        cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
            .put("body",Base64.encodeToString(cipher.doFinal(plain.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP)).toString();
    }
    @Test public void expiredAuthenticatedLegacyTrustKeepsItsOriginalScopeButCannotSendRequests() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        var preferences=context.getSharedPreferences("connection-v1",Context.MODE_PRIVATE);
        String ca=new String(Base64.decode(InstrumentationRegistry.getArguments().getString("expiredCaBase64",""),Base64.NO_WRAP),StandardCharsets.UTF_8);
        assertFalse("Host supplies only the public expired synthetic CA",ca.isEmpty());
        preferences.edit().clear().commit();var vault=new ConnectionVault(context);
        try {
            var saved=new TrustedConnection("https://original.example", "").saved().put("caPem",ca);
            String bytes=encrypted(vault,saved);assertTrue(preferences.edit().putString("encrypted",bytes).commit());
            assertEquals(NativeConnectionIdentity.storageScope("https://original.example"),vault.legacyStorageScope());
            var restored=vault.read();assertEquals("https://original.example",restored.origin);
            assertThrows(java.security.cert.CertificateExpiredException.class,()->restored.request("/api/health","GET",new JSONObject(),null));
            assertEquals("Reading expired trust never discards its authenticated legacy envelope",bytes,preferences.getString("encrypted",null));
            assertThrows(java.security.cert.CertificateExpiredException.class,()->new TrustedConnection(restored.origin,ca));
        } finally { preferences.edit().clear().commit(); }
    }
    @Test public void authenticatedLegacyScopeSurvivesJournalPromotionAndMissingOrCorruptProofFailsClosed() throws Exception {
        var context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        var preferences=context.getSharedPreferences("connection-v1",Context.MODE_PRIVATE);
        preferences.edit().clear().commit();var vault=new ConnectionVault(context);
        var original=new TrustedConnection("https://original.example", "");
        var foreign=new TrustedConnection("https://foreign.example", "");
        try {
            assertTrue(preferences.edit().putString("encrypted",encrypted(vault,original.saved())).commit());
            String proof=NativeConnectionIdentity.storageScope(original.origin);
            assertEquals(original.origin,vault.read().origin);assertEquals(proof,vault.legacyStorageScope());
            vault.write(original);assertEquals(proof,new ConnectionVault(context).legacyStorageScope());
            vault.stage(original,new JSONObject().put("candidate",foreign.saved()).put("body",new JSONObject().put("attempt","synthetic")));
            assertNotNull(new ConnectionVault(context).pending());assertEquals(proof,new ConnectionVault(context).legacyStorageScope());
            vault.promote(foreign);
            assertNull(new ConnectionVault(context).pending());assertEquals(foreign.origin,vault.read().origin);
            assertEquals("Original provenance never changes to the replacement origin",proof,new ConnectionVault(context).legacyStorageScope());
            assertNotEquals(NativeConnectionIdentity.storageScope(foreign.origin),vault.legacyStorageScope());
            JSONObject corrupted=new JSONObject(preferences.getString("encrypted",null));byte[] body=Base64.decode(corrupted.getString("body"),Base64.NO_WRAP);body[body.length-1]^=1;
            String bytes=corrupted.put("body",Base64.encodeToString(body,Base64.NO_WRAP)).toString();preferences.edit().putString("encrypted",bytes).commit();
            assertThrows(Exception.class,vault::read);assertThrows(Exception.class,vault::legacyStorageScope);
            assertEquals("Reading corrupt proof cannot discard retained data",bytes,preferences.getString("encrypted",null));
            preferences.edit().putString("encrypted",encrypted(vault,new JSONObject().put("connection",foreign.saved()))).commit();
            assertNull("Wrapped state without proof must never guess its current origin",vault.legacyStorageScope());
            JSONObject invalid=original.saved().put("origin","https://ORIGINAL.example");preferences.edit().putString("encrypted",encrypted(vault,invalid)).commit();
            assertThrows(Exception.class,vault::legacyStorageScope);
        } finally { preferences.edit().clear().commit(); }
    }
}
