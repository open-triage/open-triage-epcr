package org.opentriage.development;
import static org.junit.Assert.*;
import org.junit.Test;

public class FontProviderConnectionsTest {
    private static final String HEADER="ACTIVITY MANAGER CONTENT PROVIDERS (dumpsys activity providers)\n";
    private static final String FONT="  * ContentProviderRecord{a u0 com.google.android.gms/.fonts.provider.FontsProvider}\n    proc=ProcessRecord{b 1000:com.google.android.gms.persistent/u0a120}\n    Connections:\n";
    private static final String OTHER="  * ContentProviderRecord{c u0 com.google.android.gms/.chimera.GmsModuleProvider}\n    Connections:\n";
    private static final String CLIENT="      -> 10332:org.opentriage.development/u0a174 s1/1 u0/0 +1s\n";
    @Test public void actualFontConnectionFailsTheStrictFixtureDependencyProof() {
        var evidence=FontProviderConnections.inspect(HEADER+FONT+CLIENT,10332,"org.opentriage.development");
        assertTrue(evidence.bound());assertEquals(1,evidence.providerCount());assertTrue(evidence.records().contains(CLIENT.trim()));
    }
    @Test public void samePidUnderAnotherProviderIsNotAFontConnection() {
        var evidence=FontProviderConnections.inspect(HEADER+FONT+OTHER+CLIENT,10332,"org.opentriage.development");
        assertFalse(evidence.bound());assertEquals(1,evidence.providerCount());assertFalse(evidence.records().contains("GmsModuleProvider"));
        assertFalse(FontProviderConnections.inspect(HEADER+OTHER+CLIENT,10332,"org.opentriage.development").bound());
    }
    @Test public void pidAndPackageMustMatchExactlyInsideAConnection() {
        for(String client:new String[]{CLIENT.replace("10332:","110332:"),CLIENT.replace("development/","development.evil/"),"    proc=ProcessRecord{a 10332:org.opentriage.development/u0a174}\n"})
            assertFalse(FontProviderConnections.inspect(HEADER+FONT+client,10332,"org.opentriage.development").bound());
    }
    @Test public void authorityMappingsAndUnpublishedProviderCannotCreateFalseBindings() {
        assertFalse(FontProviderConnections.inspect(HEADER+FONT+"  User 0 authority to provider mappings:\n"+CLIENT,10332,"org.opentriage.development").bound());
        var none=FontProviderConnections.inspect(HEADER+"  (nothing)\n",10332,"org.opentriage.development");
        assertFalse(none.bound());assertEquals(0,none.providerCount());assertEquals("(not published)",none.records());
    }
    @Test public void incompleteOrFailedProbeIsNeverAcceptedAsAbsence() {
        for(String dump:new String[]{"Permission Denial","",HEADER+"x".repeat(262144)})
            assertThrows(IllegalArgumentException.class,()->FontProviderConnections.inspect(dump,10332,"org.opentriage.development"));
    }
}
