package org.opentriage.development;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.SystemClock;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;

/** Instrumentation-only. An unauthenticated TCP connect proves routing, never TLS trust. */
final class AndroidFixtureNetwork {
    @FunctionalInterface interface BrowserState { boolean online() throws Exception; }
    static void await(Context context, String origin, BrowserState browser, boolean connected) throws Exception {
        URI endpoint = URI.create(origin);
        if (!"https".equals(endpoint.getScheme()) || endpoint.getHost() == null) throw new IllegalArgumentException("Invalid fixture HTTPS origin");
        int port = endpoint.getPort() == -1 ? 443 : endpoint.getPort();
        var address = new InetSocketAddress(endpoint.getHost(), port);
        var networks = context.getSystemService(ConnectivityManager.class);
        TransportReadiness.await(connected, timeout -> {
            Boolean online = browser == null ? null : browser.online();
            var active = networks.getActiveNetwork();
            var capabilities = networks.getNetworkCapabilities(active);
            boolean internet = capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            String state = "active=" + active + ",internet=" + internet + ",validated=" +
                (capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) +
                ",wifi=" + (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) +
                ",cellular=" + (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR));
            boolean reachable = false;
            String ioClass = null, ioMessage = null;
            try (var socket = new Socket()) {
                socket.connect(address, timeout);
                reachable = true;
            } catch (java.io.IOException failure) {
                ioClass = failure.getClass().getSimpleName(); ioMessage = failure.getMessage();
            }
            return new TransportReadiness.Sample(online, internet, reachable, state, ioClass, ioMessage);
        }, SystemClock::elapsedRealtime, Thread::sleep, TransportReadiness.TIMEOUT_MS);
    }
}
