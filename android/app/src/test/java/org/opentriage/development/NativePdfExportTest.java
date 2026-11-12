package org.opentriage.development;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class NativePdfExportTest {
    @Test public void writesOnlyFreshValidatedBytesAndClearsTheirMemoryWithoutDeletingCompletedUserExport() throws Exception {
        byte[] bytes="%PDF-fresh-authorized".getBytes();byte[] expected=bytes.clone();var output=new ByteArrayOutputStream();var deletes=new AtomicInteger();var loads=new AtomicInteger();
        NativePdfExport.write(()->{loads.incrementAndGet();return bytes;},value->assertArrayEquals(expected,value),()->true,new NativePdfExport.Destination(){public OutputStream open(){return output;}public void delete(){deletes.incrementAndGet();}});
        assertEquals(1,loads.get());assertArrayEquals(expected,output.toByteArray());assertArrayEquals(new byte[bytes.length],bytes);assertEquals(0,deletes.get());
    }
    @Test public void contextLossDuringCopyCancelsThePartialDestinationAndCannotClaimSuccess() {
        var current=new AtomicBoolean(true);var writes=new AtomicInteger();var deleted=new AtomicInteger();byte[] bytes=new byte[100_000];
        assertThrows(Exception.class,()->NativePdfExport.write(()->bytes,value->{},current::get,new NativePdfExport.Destination(){
            public OutputStream open(){return new OutputStream(){public void write(int value){}public void write(byte[] value,int start,int length){writes.incrementAndGet();current.set(false);}};}
            public void delete(){deleted.incrementAndGet();}
        }));
        assertEquals(1,writes.get());assertEquals(1,deleted.get());assertArrayEquals(new byte[bytes.length],bytes);
    }
    @Test public void deniedOrMalformedFreshPdfAndIoFailuresDeleteTheEmptyOrPartialSelectedDocument() {
        for(int failure=0;failure<3;failure++){
            int stage=failure;var deleted=new AtomicInteger();var opened=new AtomicInteger();
            assertThrows(Exception.class,()->NativePdfExport.write(()->{if(stage==0)throw new IOException("denied");return new byte[100];},bytes->{if(stage==1)throw new IOException("malformed");},()->true,new NativePdfExport.Destination(){
                public OutputStream open(){opened.incrementAndGet();return new OutputStream(){public void write(int value)throws IOException{throw new IOException("provider failed");}};}
                public void delete(){deleted.incrementAndGet();}
            }));
            assertEquals(1,deleted.get());assertEquals(stage==2?1:0,opened.get());
        }
    }
}
