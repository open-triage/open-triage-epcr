package org.opentriage.development;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "OpenTriageConnection")
public class OpenTriageConnectionPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TrustedConnection active;
    private TrustedConnection candidate;
    private JSONObject pairing;
    private ConnectionVault vault;
    private boolean loaded;
    private volatile boolean destroyed;
    private void initialize() throws Exception {
        if (!loaded) { vault = new ConnectionVault(getContext()); active = vault.read(); loaded = true; }
    }
    private interface Operation { JSObject run() throws Exception; }
    private void execute(PluginCall call, Operation operation) {
        getActivity().runOnUiThread(() -> {
            String url = getBridge().getWebView().getUrl();
            if (url == null || !url.startsWith("https://localhost/")) { call.reject("Unapproved UI origin", "CONNECTION_FAILED"); return; }
            executor.execute(() -> {
                try {
                    if (destroyed) throw new IllegalStateException("Runtime closed");
                    initialize(); call.resolve(operation.run());
                }
                catch (Exception error) { call.reject("Connection or pairing failed", "CONNECTION_FAILED"); }
            });
        });
    }
    @PluginMethod public void state(PluginCall call) { execute(call, () -> {
        JSObject result = new JSObject(); result.put("configured", active != null);
        if (active != null) result.put("origin", active.origin);
        return result;
    }); }
    @PluginMethod public void preview(PluginCall call) { execute(call, () -> {
        if (active != null) throw new IllegalStateException("Use installation reassignment");
        candidate = null; pairing = null;
        JSONObject artifact = TrustedConnection.artifact(call.getString("artifact", ""), System.currentTimeMillis());
        TrustedConnection next = new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem"));
        TrustedConnection.Reply current = next.request("/api/installations/current", "GET", new JSONObject(), null);
        if (current.status() != 200) throw new IllegalStateException("Connection failed");
        TrustedConnection.Reply response = next.request("/api/installations/preview", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), new JSONObject().put("token", artifact.getString("token")).toString());
        if (response.status() != 201 && response.status() != 200) throw new IllegalStateException("Pairing rejected");
        JSONObject preview = new JSONObject(response.body());
        JSObject result = new JSObject(); result.put("origin", next.origin);
        for (String key : new String[]{"organizationName", "unitName", "callSign"}) result.put(key, preview.getString(key));
        candidate = next; pairing = artifact;
        return result;
    }); }
    @PluginMethod public void confirm(PluginCall call) { execute(call, () -> {
        if (active != null || candidate == null || pairing == null || !Boolean.TRUE.equals(call.getBoolean("confirmInstallation"))) throw new IllegalStateException("Confirmation required");
        TrustedConnection.artifact(pairing.toString(), System.currentTimeMillis());
        String name = call.getString("name", "").trim();
        if (name.isEmpty() || name.length() > 100 || name.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new IllegalArgumentException("Installation name required");
        JSONObject body = new JSONObject().put("token", pairing.getString("token")).put("name", name).put("confirmInstallation", true);
        var response = candidate.request("/api/installations/enroll", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), body.toString());
        if (response.status() != 201 && response.status() != 200) throw new IllegalStateException("Pairing rejected");
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        vault.write(candidate); active = candidate; candidate = null; pairing = null;
        JSObject result = new JSObject(); result.put("configured", true); return result;
    }); }
    @PluginMethod public void cancel(PluginCall call) { execute(call, () -> { candidate = null; pairing = null; return new JSObject(); }); }
    @PluginMethod public void request(PluginCall call) { execute(call, () -> {
        if (active == null) throw new IllegalStateException("Pairing required");
        var response = active.requestBytes(call.getString("path", ""), call.getString("method", "GET"), call.getObject("headers", new JSObject()), TrustedConnection.decodeRequestBody(call.getString("bodyBase64")));
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        vault.write(active);
        JSObject result = new JSObject(); result.put("status", response.status()); result.put("headers", response.headers()); result.put("bodyBase64", response.bodyBase64()); return result;
    }); }
    @Override protected void handleOnDestroy() { destroyed = true; executor.shutdownNow(); super.handleOnDestroy(); }
}
