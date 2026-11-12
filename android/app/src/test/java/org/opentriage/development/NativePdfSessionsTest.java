package org.opentriage.development;

import static org.junit.Assert.*;
import org.junit.Test;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

public class NativePdfSessionsTest {
    @Test public void expiryAndCurrentAuthorityCannotBeExtendedByRepeatedRendering() throws Exception {
        var clock=new AtomicLong(10);var allowed=new AtomicBoolean(true);var directory=Files.createTempDirectory("native-pdf").toFile();
        var lease=new NativePdfSessions.Session(this,java.util.UUID.randomUUID().toString(),directory,20,allowed::get,()->new byte[]{1},clock::get);
        assertTrue(lease.current());clock.set(19);assertTrue(lease.current());allowed.set(false);assertFalse(lease.current());allowed.set(true);clock.set(20);assertFalse(lease.current());lease.close();directory.delete();
    }
    @Test public void closeDeletesOnlyItsOpaquePreviewAndNeverWaitsForAnInFlightAuthorization() throws Exception {
        var directory=Files.createTempDirectory("native-pdf").toFile();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var finished=new CountDownLatch(1);
        var lease=new NativePdfSessions.Session(this,java.util.UUID.randomUUID().toString(),directory,Long.MAX_VALUE,()->true,()->{entered.countDown();release.await();return new byte[]{1,2,3};},System::currentTimeMillis);
        Thread reader=new Thread(()->{try{lease.preview();fail("Closed lease cannot create a preview");}catch(Exception expected){}finally{finished.countDown();}});reader.start();
        assertTrue(entered.await(2,TimeUnit.SECONDS));lease.close();assertFalse(lease.current());release.countDown();assertTrue(finished.await(2,TimeUnit.SECONDS));assertEquals(0,directory.list().length);directory.delete();
    }
    @Test public void backgroundClearsPrivateBytesAndTheNextViewMustAuthorizeAgain() throws Exception {
        var directory=Files.createTempDirectory("native-pdf").toFile();var loads=new java.util.concurrent.atomic.AtomicInteger();
        var lease=new NativePdfSessions.Session(this,java.util.UUID.randomUUID().toString(),directory,Long.MAX_VALUE,()->true,()->{loads.incrementAndGet();return new byte[]{1,2,3};},System::currentTimeMillis);
        var first=lease.preview();assertTrue(first.isFile());assertEquals(1,loads.get());lease.clearPreview();assertFalse(first.exists());lease.preview();assertEquals(2,loads.get());lease.close();assertEquals(0,directory.list().length);directory.delete();
    }
    @Test public void anOldCancelledOperationCannotRemoveANewerRealmOperation() throws Exception {
        Object old=new Object(),current=new Object();String id=java.util.UUID.randomUUID().toString();
        NativePdfSessions.begin(old,id);NativePdfSessions.close(old,id);NativePdfSessions.begin(current,id);
        var lifetime=new NativePdfLifetime(0,0,100,()->0L,()->0L);
        assertThrows(Exception.class,()->NativePdfSessions.create(null,old,id,lifetime,()->true,()->new byte[]{1}));
        assertTrue(NativePdfSessions.pending(current,id));NativePdfSessions.closeOwner(current);assertFalse(NativePdfSessions.alive(current,id));
        assertThrows(Exception.class,()->NativePdfSessions.begin(this,"../../arbitrary"));
    }
    @Test public void aHeldLateRefreshCannotReviveClosedAuthorityOrItsDeletedFileAndCannotOverlap() throws Exception {
        var directory=Files.createTempDirectory("native-pdf").toFile();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var calls=new java.util.concurrent.atomic.AtomicInteger();
        var lease=new NativePdfSessions.Session(this,java.util.UUID.randomUUID().toString(),directory,Long.MAX_VALUE,()->true,()->new byte[]{1,2,3},System::currentTimeMillis);
        var file=lease.preview();lease.refresher=()->{calls.incrementAndGet();entered.countDown();release.await();};
        Thread poll=new Thread(lease::reassess);poll.start();assertTrue(entered.await(2,TimeUnit.SECONDS));
        lease.reassess();assertEquals("A second timer cannot overlap the held server check",1,calls.get());
        lease.close();assertFalse(file.exists());assertFalse(lease.current());release.countDown();poll.join(2000);assertFalse(poll.isAlive());
        assertFalse(lease.current());assertThrows(Exception.class,lease::preview);assertEquals(0,directory.list().length);directory.delete();
    }
    @Test public void remoteRevocationIsTerminalWhileTransientConnectionFailureKeepsOnlyTheOriginalDeadline() throws Exception {
        var directory=Files.createTempDirectory("native-pdf").toFile();var clock=new AtomicLong(10);
        var lease=new NativePdfSessions.Session(this,java.util.UUID.randomUUID().toString(),directory,20,()->true,()->new byte[]{1},clock::get);
        var file=lease.preview();lease.refresher=()->{throw new java.io.IOException("network unavailable");};lease.reassess();assertTrue(lease.current());
        lease.refresher=()->{throw new NativePdfSessions.Revoked();};lease.reassess();assertFalse(lease.current());assertFalse(file.exists());
        clock.set(11);lease.refresher=()->{};lease.reassess();assertFalse(lease.current());directory.delete();
    }
}
