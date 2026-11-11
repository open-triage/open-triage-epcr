package org.opentriage.development;
import static org.junit.Assert.*;
import org.junit.Test;
public class NativeConnectionIdentityTest {
    @Test public void opaqueScopesAreStableAndKeepDistinctOriginsApart() throws Exception {
        String original=NativeConnectionIdentity.storageScope("https://original.example");
        assertTrue(original.matches("[A-Za-z0-9_-]{43}"));
        assertEquals(original,NativeConnectionIdentity.storageScope("https://original.example"));
        assertNotEquals(original,NativeConnectionIdentity.storageScope("https://different.example"));
        assertNotEquals(original,NativeConnectionIdentity.storageScope("https://original.example:9443"));
    }
}
