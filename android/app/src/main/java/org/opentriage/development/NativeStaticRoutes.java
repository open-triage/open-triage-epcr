package org.opentriage.development;

import java.net.URI;
import java.util.function.Predicate;

/** Resolve bundled static documents without Capacitor's single-page index fallback. */
final class NativeStaticRoutes {
    record Target(String path, boolean notFound) {}
    private static final Target BLOCKED = new Target(null, true);
    static Target resolve(String url, String method, boolean mainFrame, Predicate<String> assetExists) {
        if (!mainFrame) return null;
        if (!"GET".equals(method) || url == null || url.length() > 8192) return BLOCKED;
        final URI uri;
        try { uri = URI.create(url); } catch (IllegalArgumentException invalid) { return BLOCKED; }
        if (!"https".equals(uri.getScheme()) || !"localhost".equals(uri.getRawAuthority())) return BLOCKED;
        String path = uri.getRawPath();
        if (path == null || path.isEmpty() || path.equals("/")) return null;
        if (path.contains("%") || path.contains("\\") || path.contains("//") || path.contains("..") || path.contains("/./") || path.endsWith("/.")
            || !path.matches("/[A-Za-z0-9_./-]+")) return BLOCKED;
        String leaf = path.substring(path.lastIndexOf('/') + 1);
        if (leaf.contains(".")) return null; // Framework serves explicit assets, including HTML injection.
        if (!path.matches("(?:/[A-Za-z0-9_-]+)+/?")) return BLOCKED;
        String document = path + (path.endsWith("/") ? "" : "/") + "index.html";
        if (assetExists.test("public" + document)) return new Target(document, false);
        return assetExists.test("public/404/index.html") ? new Target("/404/index.html", true) : BLOCKED;
    }
}
