package org.opentriage.development;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
    private volatile TrustedConnection active;
    private TrustedConnection candidate;
    private JSONObject pairing;
    private ConnectionVault vault;
    private boolean loaded;
    private ManagedConfiguration management;
    private BroadcastReceiver restrictionReceiver;
    private final ManagedPolicyRevision revisions = new ManagedPolicyRevision();
    private final Object policyLock = new Object();
    private final ExecutorService policyObserver = Executors.newSingleThreadExecutor();
    private volatile boolean destroyed;
    private void initialize() throws Exception {
        if (!loaded) {
            vault = new ConnectionVault(getContext()); active = vault.read();
            if (management == null) management = new ManagedConfiguration(getContext());
            sampledPolicy(); loaded = true;
        }
    }
    @Override public void load() {
        management = new ManagedConfiguration(getContext());
        restrictionReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { refreshManagement(); }
        };
        getContext().registerReceiver(restrictionReceiver, new IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED), Context.RECEIVER_NOT_EXPORTED);
    }
    private void refreshManagement() {
        if (destroyed) return;
        policyObserver.execute(() -> {
            try {
                var observed = sampledPolicy(); // Observe changes even while a request occupies the connection executor.
                TrustedConnection retained = active;
                var effectiveObserved = observed.forConnection(retained);
                // A blocked policy must lock readable UI immediately, not wait behind an in-flight HTTP request.
                if (effectiveObserved.blocked() && !destroyed) notifyListeners("configurationChanged", statePayload(effectiveObserved, retained));
                if (destroyed) return;
                executor.execute(() -> {
                    if (destroyed) return;
                    try {
                        initialize(); var effective = policy();
                        if (effective.blocked() || candidate != null && effective.managed() && !effective.matches(candidate)) { candidate = null; pairing = null; }
                        if (!destroyed) notifyListeners("configurationChanged", connectionState());
                    } catch (Exception ignored) {
                        JSObject failed = new JSObject(); failed.put("configured", false); failed.put("managed", true); failed.put("blocked", true); failed.put("managedStatus", "unavailable");
                        if (!destroyed) notifyListeners("configurationChanged", failed);
                    }
                });
            } catch (Exception ignored) { /* Every credential operation independently fails closed. */ }
        });
    }
    private ManagedConnectionPolicy.State sampledPolicy() throws Exception {
        synchronized (policyLock) {
            var state = management.refresh(); revisions.observe(state); return state;
        }
    }
    @Override protected void handleOnResume() { refreshManagement(); super.handleOnResume(); }
    private ManagedConnectionPolicy.State policy() throws Exception { return sampledPolicy().forConnection(active); }
    private JSObject connectionState() throws Exception {
        TrustedConnection retained = active;
        return statePayload(sampledPolicy().forConnection(retained), retained);
    }
    private JSObject statePayload(ManagedConnectionPolicy.State policy, TrustedConnection retained) {
        JSObject result = new JSObject(); result.put("configured", retained != null && !policy.blocked());
        result.put("managed", policy.managed()); result.put("managedStatus", policy.status()); result.put("blocked", policy.blocked());
        if (retained != null) result.put("origin", retained.origin);
        if (policy.origin() != null) result.put("managedOrigin", policy.origin());
        if (policy.context() != null) result.put("managedContext", policy.context());
        return result;
    }
    private void allowed(TrustedConnection connection) throws Exception {
        var policy = policy();
        if (policy.blocked()) throw new ManagedFailure("MANAGED_BLOCKED");
        if (policy.managed() && !policy.matches(connection)) throw new ManagedFailure("MANAGED_CONFLICT");
    }
    private TrustedConnection.Reply managedRequest(TrustedConnection connection, String path, String method, JSONObject headers, String body) throws Exception {
        allowed(connection);
        long generation = revisions.current();
        var reply = connection.request(path, method, headers, body);
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        allowed(connection);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        return reply;
    }
    private static class ManagedFailure extends Exception {
        final String code;
        ManagedFailure(String code) { this.code = code; }
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
                catch (ManagedFailure error) {
                    try { if (!destroyed) notifyListeners("configurationChanged", connectionState()); } catch (Exception ignored) { /* The request already fails closed. */ }
                    call.reject("Managed connection requires attention", error.code);
                }
                catch (Exception error) { call.reject("Connection or pairing failed", "CONNECTION_FAILED"); }
            });
        });
    }
    @PluginMethod public void state(PluginCall call) { execute(call, () -> {
        return connectionState();
    }); }
    @PluginMethod public void preview(PluginCall call) { execute(call, () -> {
        if (active != null) throw new IllegalStateException("Use installation reassignment");
        candidate = null; pairing = null;
        JSONObject artifact = TrustedConnection.artifact(call.getString("artifact", ""), System.currentTimeMillis());
        TrustedConnection next = new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem"));
        allowed(next);
        long generation = revisions.current();
        TrustedConnection.Reply current = managedRequest(next, "/api/installations/current", "GET", new JSONObject(), null);
        if (current.status() != 200) throw new IllegalStateException("Connection failed");
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        TrustedConnection.Reply response = managedRequest(next, "/api/installations/preview", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), new JSONObject().put("token", artifact.getString("token")).toString());
        if (response.status() != 201 && response.status() != 200) throw new IllegalStateException("Pairing rejected");
        allowed(next);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
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
        allowed(candidate);
        long generation = revisions.current();
        JSONObject body = new JSONObject().put("token", pairing.getString("token")).put("name", name).put("confirmInstallation", true);
        var response = managedRequest(candidate, "/api/installations/enroll", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), body.toString());
        if (response.status() != 201 && response.status() != 200) throw new IllegalStateException("Pairing rejected");
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        allowed(candidate);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        vault.write(candidate); active = candidate; candidate = null; pairing = null;
        JSObject result = new JSObject(); result.put("configured", true); return result;
    }); }
    @PluginMethod public void cancel(PluginCall call) { execute(call, () -> { candidate = null; pairing = null; return new JSObject(); }); }
    @PluginMethod public void request(PluginCall call) { execute(call, () -> {
        if (active == null) throw new IllegalStateException("Pairing required");
        allowed(active);
        long generation = revisions.current();
        var response = managedRequest(active, call.getString("path", ""), call.getString("method", "GET"), call.getObject("headers", new JSObject()), call.getString("body"));
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        allowed(active);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        vault.write(active);
        JSObject result = new JSObject(); result.put("status", response.status()); result.put("headers", response.headers()); result.put("body", response.body()); return result;
    }); }
    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (restrictionReceiver != null) getContext().unregisterReceiver(restrictionReceiver);
        policyObserver.shutdownNow(); executor.shutdownNow(); super.handleOnDestroy();
    }
}
