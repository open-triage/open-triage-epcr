package org.opentriage.development;
import static org.junit.Assert.*;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
public class NativeStaticRoutesTest {
    private final Set<String> assets=Set.of("public/review-call/index.html","public/enroll/index.html","public/admin/users/index.html","public/404/index.html");
    @Test public void exportedDocumentsUseTheirActualIndexAndIgnoreQueryForAssetLookup(){
        for(String path:new String[]{"/review-call/","/enroll","/admin/users/"}){
            var result=NativeStaticRoutes.resolve("https://localhost"+path+"?report=a%2Fb&language=sv","GET",true,assets::contains);
            assertEquals(path+(path.endsWith("/")?"":"/")+"index.html",result.path());assertFalse(result.notFound());
        }
    }
    @Test public void unknownCanonicalRoutesUseBundled404WithoutHomeFallback(){
        var result=NativeStaticRoutes.resolve("https://localhost/missing/","GET",true,assets::contains);
        assertEquals("/404/index.html",result.path());assertTrue(result.notFound());
        assertNull(NativeStaticRoutes.resolve("https://localhost/missing/","GET",true,path->false).path());
    }
    @Test public void unsafeOriginsMethodsAndPathsNeverReadAnAsset(){
        var reads=new AtomicInteger();
        for(String url:new String[]{"https://foreign.test/review-call/","http://localhost/review-call/","https://user@localhost/review-call/","https://localhost:443/review-call/","https://localhost/a/../review-call/","https://localhost/%2e%2e/review-call/","https://localhost/review%2Fcall/","https://localhost//review-call/","https://localhost/./review-call/"}){
            var result=NativeStaticRoutes.resolve(url,"GET",true,path->{reads.incrementAndGet();return true;});assertNotNull(url,result);assertNull(url,result.path());assertTrue(result.notFound());
        }
        assertNull(NativeStaticRoutes.resolve("https://localhost/review-call/","POST",true,path->{reads.incrementAndGet();return true;}).path());assertEquals(0,reads.get());
    }
    @Test public void frameworkResourcesAndRootKeepTheirExistingHandling(){
        for(String path:new String[]{"/","/_next/static/chunk.js","/review-call/index.html"})assertNull(NativeStaticRoutes.resolve("https://localhost"+path,"GET",true,assets::contains));
        assertNull(NativeStaticRoutes.resolve("https://localhost/review-call/","GET",false,path->{fail("Subresources must not trigger document lookup");return false;}));
    }
}
