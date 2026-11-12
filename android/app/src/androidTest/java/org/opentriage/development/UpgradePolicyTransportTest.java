package org.opentriage.development;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** No Activity/WebView is launched: package replacement must not synchronize the
 * pending clinical record before the existing offline-restart assertion. */
@RunWith(AndroidJUnit4.class)
public class UpgradePolicyTransportTest {
    @Test public void realInstalledTransportHonorsAuthoritativeRetirement() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        var context=instrumentation.getTargetContext();
        var args=InstrumentationRegistry.getArguments();
        long version=context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode();
        assertEquals(Long.parseLong(args.getString("expectedVersion")),version);
        var connection=new ConnectionVault(context).read();assertNotNull("Retained Keystore provisioning must remain available",connection);
        // Current wrappers preserve this stable method for immutable previous APK A.
        // Wait for real transport readiness after the host restores radios; one
        // credentialed TLS operation must not race Android's network creation.
        var endpoint=java.net.URI.create(connection.origin);
        var connectivity=(android.net.ConnectivityManager)context.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        long deadline=System.currentTimeMillis()+45000;boolean reachable=false;
        while(!reachable && System.currentTimeMillis()<deadline) {
            var network=connectivity.getActiveNetwork();var capabilities=network==null?null:connectivity.getNetworkCapabilities(network);
            if(capabilities!=null && capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                try(var socket=new java.net.Socket()) {socket.connect(new java.net.InetSocketAddress(endpoint.getHost(),endpoint.getPort()<0?443:endpoint.getPort()),250);reachable=true;}
                catch(java.io.IOException waitingForNetwork) { /* Only unauthenticated readiness polling. */ }
            }
            if(!reachable)Thread.sleep(100);
        }
        assertTrue("The real Android transport must be ready before its single credentialed request",reachable);
        var session=connection.request("/api/sessions/current","GET",new JSONObject(),null);
        assertEquals("Ordinary personal session remains valid; no reauthentication",200,session.status());
        String csrf=new JSONObject(session.body()).getString("csrfToken");
        boolean legacy="1".equals(args.getString("legacy"));
        var headers=new JSONObject().put("x-csrf-token",csrf);
        TrustedConnection.Reply opened;
        String path="/api/calls/"+args.getString("assignmentId")+"/open";
        if(legacy) {
            assertTrue("Immutable Java transport has the evidenced legacy Android agent",System.getProperty("http.agent","").startsWith("Dalvik/"));
            opened=connection.request(path,"POST",headers,null);
        } else opened=connection.requestBytes(path,"POST",headers,null,version);
        assertEquals("The actual server must gate new work using its retirement metadata",Integer.parseInt(args.getString("expectedStatus")),opened.status());
        if(opened.status()==426)assertEquals("android.upgradeRequired",new JSONObject(opened.body()).getString("code"));
        var status=new android.os.Bundle();status.putString("opentriage_upgrade_installed_version",Long.toString(version));
        status.putString("opentriage_upgrade_new_work_status",Integer.toString(opened.status()));
        instrumentation.sendStatus(0,status);
    }
}
