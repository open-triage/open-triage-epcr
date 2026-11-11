package org.opentriage.development;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(OpenTriageConnectionPlugin.class);
        registerPlugin(OpenTriageScannerPlugin.class);
        super.onCreate(state);
        // CapacitorCookies installs a global handler even when JS patching is disabled.
        // It would copy native credentials into the WebView cookie store. Own them solely in the vault.
        java.net.CookieHandler.setDefault(null);
        // Remote pages must never inherit the native bridge. OIDC adds an explicit return flow in slice 006.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                var uri = request.getUrl();
                return !("https".equals(uri.getScheme()) && "localhost".equals(uri.getHost()) && uri.getPort() == -1);
            }
        });
    }
}
