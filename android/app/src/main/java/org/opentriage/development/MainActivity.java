package org.opentriage.development;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        NativePdfSessions.cleanOrphans(this);
        // Clinical text must not become an OS-persisted recents thumbnail or screen capture.
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        registerPlugin(OpenTriageConnectionPlugin.class);
        registerPlugin(OpenTriageScannerPlugin.class);
        registerPlugin(OpenTriageLifecyclePlugin.class);
        super.onCreate(state);
        applyTextScale();
        // CapacitorCookies installs a global handler even when JS patching is disabled.
        // It would copy native credentials into the WebView cookie store. Own them solely in the vault.
        java.net.CookieHandler.setDefault(null);
        // Remote pages never inherit the native bridge. OIDC uses the external system browser.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                var uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "localhost".equals(uri.getHost()) && uri.getPort() == -1) return false;
                var release = OfficialApkLink.approved(uri.toString());
                if (release != null && request.isForMainFrame() && request.hasGesture()) {
                    try {
                        var intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(release.toString()));
                        intent.addCategory(android.content.Intent.CATEGORY_BROWSABLE);
                        startActivity(intent);
                    } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
                        // Only public release metadata crosses this boundary; no app credentials or CA state.
                        view.evaluateJavascript("window.dispatchEvent(new CustomEvent('open-triage.apk-download-failed',{detail:{url:"
                            + org.json.JSONObject.quote(release.toString()) + "}}))", null);
                    }
                }
                return true;
            }
        });
    }

    private void applyTextScale() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().getSettings().setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        }
    }

    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // Keep the current editor/recorder realm while honoring Android's accessibility setting.
        applyTextScale();
    }
}
