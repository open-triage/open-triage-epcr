package org.opentriage.development;

import java.net.URI;
import java.util.Set;

/** Only public application-shell requests may use the paired web UI transport. */
final class NativeUiRequest {
    static String path(String url, String method) {
        if (!"GET".equals(method) || url == null || url.length() > 8192) return null;
        final URI uri;
        try { uri = URI.create(url); } catch (IllegalArgumentException invalid) { return null; }
        if (!"https".equals(uri.getScheme()) || !"localhost".equals(uri.getRawAuthority()) || uri.getRawFragment() != null) return null;
        String path = uri.getPath();
        if (path == null || !path.matches("/[A-Za-z0-9_./()\\[\\]-]*") || path.contains("..") || path.contains("//") || path.contains("/./")) return null;
        boolean document = Set.of("/", "/index.html", "/enroll/", "/enroll", "/review-call/", "/review-call", "/admin-preview/", "/admin-preview").contains(path);
        boolean asset = path.startsWith("/_next/static/") && path.matches(".*\\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|ico)$");
        if (!document && !asset && !Set.of("/sw.js", "/manifest.webmanifest", "/favicon.ico").contains(path)) return null;
        String serverPath = uri.getRawPath();
        if (document && !serverPath.endsWith("/") && !serverPath.endsWith(".html")) serverPath += "/";
        return serverPath + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
    }
    static boolean accepts(String path, String mime) {
        String name = path.split("\\?", 2)[0];
        if (mime == null) return false;
        String type = mime.split(";", 2)[0].trim().toLowerCase(java.util.Locale.ROOT);
        if (name.endsWith(".js")) return Set.of("application/javascript", "text/javascript").contains(type);
        if (name.endsWith(".css")) return type.equals("text/css");
        if (name.endsWith(".webmanifest")) return Set.of("application/manifest+json", "application/json").contains(type);
        if (name.matches(".*\\.(?:woff2?|ttf)$")) return type.startsWith("font/") || Set.of("application/font-woff", "application/octet-stream", "application/x-font-ttf").contains(type);
        if (name.matches(".*\\.(?:png|jpe?g|webp|svg|ico)$")) return type.startsWith("image/");
        return type.equals("text/html");
    }
}
