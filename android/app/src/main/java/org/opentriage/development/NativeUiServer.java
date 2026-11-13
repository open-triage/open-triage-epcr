package org.opentriage.development;

import android.content.Context;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.util.Map;

/** Keeps the local WebView origin and browser service worker while fetching public UI from the paired server. */
final class NativeUiServer {
    private final Context context;
    NativeUiServer(Context context) { this.context = context.getApplicationContext(); }
    WebResourceResponse intercept(WebResourceRequest request, boolean worker) {
        String path = NativeUiRequest.path(request.getUrl().toString(), request.getMethod());
        if (path == null) return null;
        // Capacitor injects the native bridge at document start, including documents from CacheStorage.
        if (!androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) return null;
        try {
            var vault = new ConnectionVault(context); var retained = vault.read();
            if (retained == null || vault.pending() != null || vault.pendingHandoff() != null || new ManagedConfiguration(context).refresh().forConnection(retained).blocked()) return unavailable(worker);
            // Construct a credential-free transport: neither vault cookies nor WebView request headers are forwarded.
            var response = new TrustedConnection(retained.origin, retained.caPem).publicUi(path);
            var current = vault.read();
            if (current == null || !current.origin.equals(retained.origin) || !current.caPem.equals(retained.caPem) ||
                vault.pending() != null || vault.pendingHandoff() != null || new ManagedConfiguration(context).refresh().forConnection(current).blocked()) return unavailable(worker);
            String contentType = response.headers().getString("content-type");
            return new WebResourceResponse(contentType.split(";", 2)[0], "UTF-8", 200, "OK",
                Map.of("Cache-Control", "no-cache", "X-Content-Type-Options", "nosniff"), new ByteArrayInputStream(response.bytes()));
        } catch (Exception unavailable) { return unavailable(worker); }
    }
    private static WebResourceResponse unavailable(boolean worker) {
        // Worker requests must fail so the shared worker uses its verified cache rather than overwriting it with APK assets.
        return !worker ? null : new WebResourceResponse("text/plain", "UTF-8", 503, "UI unavailable",
            Map.of("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }
}
