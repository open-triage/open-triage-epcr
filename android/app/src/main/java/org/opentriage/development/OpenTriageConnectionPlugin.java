package org.opentriage.development;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "OpenTriageConnection")
public class OpenTriageConnectionPlugin extends LifecycleBoundPlugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile TrustedConnection active;
    private TrustedConnection candidate;
    private JSONObject pairing;
    private JSONObject pendingTrustArtifact;
    private TrustedConnection pendingTrustCandidate;
    private long pendingTrustRevision = -1;
    private volatile String pendingOutcome;
    private ConnectionVault vault;
    private boolean loaded;
    private volatile JSONObject pendingEnrollment;
    private volatile boolean replacing;
    private volatile String connectionContext = java.util.UUID.randomUUID().toString();
    private ManagedConfiguration management;
    private BroadcastReceiver restrictionReceiver;
    private final ManagedPolicyRevision revisions = new ManagedPolicyRevision();
    private final Object policyLock = new Object();
    private final ExecutorService policyObserver = Executors.newSingleThreadExecutor();
    private volatile boolean destroyed;
    private void initialize() throws Exception {
        if (!loaded) {
            vault = new ConnectionVault(getContext()); active = vault.read(); pendingEnrollment = vault.pending();
            if (management == null) management = new ManagedConfiguration(getContext());
            sampledPolicy(); loaded = true;
        }
    }
    @Override protected void onReplyRealmReady() {
        super.onReplyRealmReady();
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
                var effectiveObserved = pairingPolicy(observed, retained);
                // A blocked policy must lock readable UI immediately, not wait behind an in-flight HTTP request.
                if (effectiveObserved.blocked() && !destroyed) notifyListeners("configurationChanged", statePayload(effectiveObserved, retained));
                if (destroyed) return;
                executor.execute(() -> {
                    if (destroyed) return;
                    try {
                        initialize(); var effective = pairingPolicy(sampledPolicy(), active);
                        if (effective.blocked() || candidate != null && effective.managed() && !effective.matches(candidate)) { candidate = null; pairing = null; }
                        if (effective.blocked() || pendingTrustCandidate != null && effective.managed() && !effective.matches(pendingTrustCandidate)) { pendingTrustCandidate = null; pendingTrustArtifact = null; }
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
    private ManagedConnectionPolicy.State pairingPolicy(ManagedConnectionPolicy.State raw, TrustedConnection retained) throws Exception { return replacing || pendingEnrollment != null ? raw : raw.forConnection(retained); }
    private ManagedConnectionPolicy.State policy() throws Exception { return sampledPolicy().forConnection(active); }
    private JSObject connectionState() throws Exception {
        TrustedConnection retained = active;
        return statePayload(pairingPolicy(sampledPolicy(), retained), retained);
    }
    private JSObject statePayload(ManagedConnectionPolicy.State policy, TrustedConnection retained) throws Exception {
        JSObject result = new JSObject(); result.put("configured", retained != null && !policy.blocked() && pendingEnrollment == null && !replacing);
        result.put("connectionContext", connectionContext); result.put("replacementPending", pendingEnrollment != null);
        if (pendingEnrollment != null) {
            result.put("pendingOrigin", pendingEnrollment.getJSONObject("candidate").getString("origin"));
            if (pendingOutcome != null) result.put("pendingOutcome", pendingOutcome);
        }
        result.put("managed", policy.managed()); result.put("managedStatus", policy.status()); result.put("blocked", policy.blocked());
        if (retained != null) { result.put("origin", retained.origin); result.put("storageScope", NativeConnectionIdentity.storageScope(retained.origin)); }
        if (vault != null) { String legacyScope = vault.legacyStorageScope(); if (legacyScope != null) result.put("legacyStorageScope", legacyScope); }
        if (policy.origin() != null) result.put("managedOrigin", policy.origin());
        if (policy.context() != null) result.put("managedContext", policy.context());
        return result;
    }
    private void allowed(TrustedConnection connection) throws Exception {
        var policy = policy();
        if (policy.blocked()) throw new ManagedFailure("MANAGED_BLOCKED");
        if (policy.managed() && !policy.matches(connection)) throw new ManagedFailure("MANAGED_CONFLICT");
    }
    private void allowedCandidate(TrustedConnection connection) throws Exception {
        var policy = sampledPolicy();
        if (policy.blocked()) throw new ManagedFailure("MANAGED_BLOCKED");
        if (policy.managed() && !policy.matches(connection)) throw new ManagedFailure("MANAGED_CONFLICT");
    }
    private TrustedConnection.Reply candidateRequest(TrustedConnection connection, String path, String method, JSONObject headers, String body) throws Exception {
        allowedCandidate(connection); long generation = revisions.current();
        var reply = connection.request(path, method, headers, body);
        allowedCandidate(connection);
        if (destroyed || Thread.currentThread().isInterrupted() || generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        return reply;
    }
    private TrustedConnection.Reply managedRequest(TrustedConnection connection, String path, String method, JSONObject headers, String body) throws Exception {
        return managedRequestBytes(connection, path, method, headers, body == null ? null : body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private TrustedConnection.Reply managedRequestBytes(TrustedConnection connection, String path, String method, JSONObject headers, byte[] body) throws Exception {
        allowed(connection);
        long generation = revisions.current();
        var reply = connection.requestBytes(path, method, headers, body, installedVersion());
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        allowed(connection);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        return reply;
    }
    private static class ManagedFailure extends Exception {
        final String code;
        ManagedFailure(String code) { this.code = code; }
    }
    private static class EnrollmentFailure extends Exception {
        final String code;
        EnrollmentFailure(String code) { this.code = code; }
    }
    private interface Operation { JSObject run() throws Exception; }
    private void execute(PluginCall call, Operation operation) {
        withReplyRealm(call, () -> {
            String url = getBridge().getWebView().getUrl();
            if (url == null || !url.startsWith("https://localhost/")) { rejectCall(call, "Unapproved UI origin", "CONNECTION_FAILED"); return; }
            executor.execute(() -> {
                try {
                    if (destroyed) throw new IllegalStateException("Runtime closed");
                    initialize(); resolveCall(call, operation.run());
                }
                catch (ManagedFailure error) {
                    try { if (!destroyed) notifyListeners("configurationChanged", connectionState()); } catch (Exception ignored) { /* The request already fails closed. */ }
                    rejectCall(call, "Managed connection requires attention", error.code);
                }
                catch (EnrollmentFailure error) { rejectCall(call, "Pending enrollment requires attention", error.code); }
                catch (Exception error) { rejectCall(call, "Connection or pairing failed", ConnectionFailure.code(error)); }
            });
        });
    }
    private long installedVersion() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).getLongVersionCode();
    }
    @PluginMethod public void version(PluginCall call) { execute(call, () -> {
        JSObject result = new JSObject(); result.put("versionCode", installedVersion()); return result;
    }); }
    @PluginMethod public void state(PluginCall call) { execute(call, () -> {
        return connectionState();
    }); }
    @PluginMethod public void reconcileTransition(PluginCall call) { execute(call, () -> {
        if (active == null || pendingEnrollment != null || replacing || !connectionContext.equals(call.getString("connectionContext"))) throw new IllegalStateException("Installation transition is not settled");
        String purpose = call.getString("purpose", "");
        if (!purpose.equals("enrollment") && !purpose.equals("logout")) throw new IllegalArgumentException("Unknown transition purpose");
        allowed(active); long revision = revisions.current();
        // stage() strips personal cookies durably before the first confirmation
        // POST; promotion/abandonment never copy them back. A remaining valid
        // native login therefore belongs to an unconfirmed transition.
        vault.pendingAuthentication(null);
        if (purpose.equals("logout")) { active = active.installationOnly(); vault.write(active); }
        allowed(active);
        if (revision != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        connectionContext = java.util.UUID.randomUUID().toString();
        return connectionState();
    }); }
    @PluginMethod public void preview(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment != null || active != null && !replacing) throw new IllegalStateException("Use installation reassignment");
        candidate = null; pairing = null;
        JSONObject artifact = TrustedConnection.artifact(call.getString("artifact", ""), System.currentTimeMillis());
        TrustedConnection next = active == null ? new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem")) : active.enrollmentCandidate(artifact.getString("origin"), artifact.getString("caPem"));
        allowedCandidate(next);
        long generation = revisions.current();
        TrustedConnection.Reply current = candidateRequest(next, "/api/installations/current", "GET", new JSONObject(), null);
        if (current.status() != 200) throw new IllegalStateException("Connection failed");
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        TrustedConnection.Reply response = candidateRequest(next, "/api/installations/preview", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), new JSONObject().put("token", artifact.getString("token")).toString());
        if (response.status() != 201 && response.status() != 200) throw new IllegalStateException("Pairing rejected");
        allowedCandidate(next);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        JSONObject preview = new JSONObject(response.body());
        JSObject result = new JSObject(); result.put("origin", next.origin);
        for (String key : new String[]{"organizationName", "unitName", "callSign"}) result.put(key, preview.getString(key));
        candidate = next; pairing = artifact;
        pairing.put("reassign", new JSONObject(current.body()).optBoolean("enrolled", false));
        return result;
    }); }
    @PluginMethod public void confirm(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment != null || active != null && !replacing || candidate == null || pairing == null || !Boolean.TRUE.equals(call.getBoolean("confirmInstallation"))) throw new IllegalStateException("Confirmation required");
        JSONObject artifact = new JSONObject(pairing.toString()); artifact.remove("reassign");
        TrustedConnection.artifact(artifact.toString(), System.currentTimeMillis());
        String name = NativeEnrollmentAttempt.normalizedName(call.getString("name", ""));
        if (name.isEmpty() || name.length() > 100 || name.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new IllegalArgumentException("Installation name required");
        allowedCandidate(candidate);
        byte[] secret = new byte[32]; new java.security.SecureRandom().nextBytes(secret);
        String attempt = android.util.Base64.encodeToString(secret, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
        JSONObject body = new JSONObject().put("token", pairing.getString("token")).put("name", name).put("confirmInstallation", true).put("attempt", attempt);
        if (pairing.optBoolean("reassign")) body.put("reassign", true);
        JSONObject prepared = new JSONObject().put("candidate", candidate.saved()).put("body", body).put("createdAt", System.currentTimeMillis());
        TrustedConnection retained = active == null ? null : active.installationOnly();
        vault.stage(retained, prepared); active = retained; pendingEnrollment = prepared; connectionContext = java.util.UUID.randomUUID().toString();
        vault.pendingAuthentication(null);
        return finishEnrollment(true);
    }); }
    private JSObject finishEnrollment(boolean firstRequest) throws Exception {
        if (pendingEnrollment == null) throw new IllegalStateException("No pending enrollment");
        TrustedConnection next = TrustedConnection.restore(pendingEnrollment.getJSONObject("candidate"));
        allowedCandidate(next); long generation = revisions.current();
        pendingOutcome = null;
        if (!firstRequest) {
            TrustedConnection recovered = NativeEnrollmentAttempt.resultConnection(pendingEnrollment, System.currentTimeMillis());
            var proof = candidateRequest(recovered, "/api/installations/current", "GET", new JSONObject(), null);
            if (proof.status() != 200) throw new EnrollmentFailure("ENROLLMENT_UNAVAILABLE");
            JSONObject observed = new JSONObject(proof.body());
            if (observed.optBoolean("enrolled")) {
                JSONObject installation = observed.getJSONObject("installation");
                for (String key : new String[]{"id","installationId","organizationId","unitId"}) if (!installation.getString(key).matches("[a-fA-F0-9-]{36}")) throw new EnrollmentFailure("ENROLLMENT_UNAVAILABLE");
                allowedCandidate(recovered);
                if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
                return promoteEnrollment(recovered);
            }
        }
        var response = candidateRequest(next, "/api/installations/enroll", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), pendingEnrollment.getJSONObject("body").toString());
        if (response.status() != 201 && response.status() != 200) {
            pendingOutcome = readPendingOutcome(next);
            throw new EnrollmentFailure("not-committed".equals(pendingOutcome) ? "ENROLLMENT_NOT_COMMITTED" : "ENROLLMENT_UNAVAILABLE");
        }
        allowedCandidate(next);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        return promoteEnrollment(next);
    }
    private JSObject promoteEnrollment(TrustedConnection next) throws Exception {
        // The proved credential and journal removal share one encrypted durable commit.
        vault.promote(next); active = next; pendingEnrollment = null; replacing = false; candidate = null; pairing = null;
        pendingTrustArtifact = null; pendingTrustCandidate = null; pendingOutcome = null;
        connectionContext = java.util.UUID.randomUUID().toString();
        return connectionState();
    }
    private String readPendingOutcome(TrustedConnection original) throws Exception {
        var outcome = candidateRequest(original, "/api/installations/enrollment-outcome", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), pendingEnrollment.getJSONObject("body").toString());
        if (outcome.status() != 200 && outcome.status() != 201) return "unavailable";
        String status = new JSONObject(outcome.body()).optString("status");
        return java.util.Set.of("not-committed","pending","result-unavailable","unavailable").contains(status) ? status : "unavailable";
    }
    @PluginMethod public void previewPendingTrust(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment == null) throw new IllegalStateException("No pending enrollment");
        pendingTrustArtifact = null; pendingTrustCandidate = null;
        JSONObject artifact = TrustedConnection.artifact(call.getString("artifact", ""), System.currentTimeMillis());
        JSONObject original = pendingEnrollment.getJSONObject("candidate");
        if (!artifact.getString("origin").equals(original.getString("origin"))) throw new IllegalArgumentException("Pending enrollment origin cannot change");
        // The artifact supplies trust only: its token never replaces the confirmed intent.
        new TrustedConnection(artifact.getString("origin"), artifact.getString("caPem"));
        TrustedConnection proposed = TrustedConnection.restore(new JSONObject(original.toString()).put("caPem", artifact.getString("caPem")));
        allowedCandidate(proposed);
        // Before explicit trust confirmation, send only the fresh artifact's
        // bootstrap authority, never the original pending installation cookie.
        TrustedConnection probe = new TrustedConnection(proposed.origin, proposed.caPem);
        var response = candidateRequest(probe, "/api/installations/current", "GET", new JSONObject(), null);
        if (response.status() != 200) throw new IllegalStateException("Connection failed");
        var fresh = candidateRequest(probe, "/api/installations/preview", "POST", new JSONObject().put("content-type", "application/json").put("x-installation-enrollment", "1"), new JSONObject().put("token", artifact.getString("token")).toString());
        if (fresh.status() != 200 && fresh.status() != 201) throw new IllegalStateException("Fresh trust artifact unavailable");
        pendingTrustCandidate = proposed; pendingTrustArtifact = artifact;
        pendingTrustRevision = revisions.current();
        JSObject result = new JSObject(); result.put("origin", proposed.origin);
        result.put("trustFingerprint", ManagedConnectionPolicy.context(proposed.origin, proposed.caPem));return result;
    }); }
    @PluginMethod public void confirmPendingTrust(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment == null || pendingTrustCandidate == null || pendingTrustArtifact == null || !Boolean.TRUE.equals(call.getBoolean("confirmTrust"))) throw new IllegalStateException("Trust confirmation required");
        TrustedConnection.artifact(pendingTrustArtifact.toString(), System.currentTimeMillis());allowedCandidate(pendingTrustCandidate);
        if (pendingTrustRevision != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        JSONObject updated = NativeEnrollmentAttempt.replaceTrust(pendingEnrollment, pendingTrustCandidate.origin, pendingTrustCandidate.caPem);
        // Body/token/attempt/original cookie, original creation time and legacy proof remain unchanged.
        vault.stage(active, updated);pendingEnrollment = updated;pendingTrustCandidate = null;pendingTrustArtifact = null;pendingOutcome = null;
        connectionContext = java.util.UUID.randomUUID().toString();return connectionState();
    }); }
    @PluginMethod public void abandonUncommittedEnrollment(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment == null || !Boolean.TRUE.equals(call.getBoolean("confirmAbandon"))) throw new IllegalStateException("Explicit confirmation required");
        pendingOutcome = null;
        String proved = readPendingOutcome(TrustedConnection.restore(pendingEnrollment.getJSONObject("candidate")));
        pendingOutcome = proved;
        if (!proved.equals("not-committed")) throw new EnrollmentFailure("ENROLLMENT_UNAVAILABLE");
        vault.promote(active);pendingEnrollment = null;pendingOutcome = null;pendingTrustCandidate = null;pendingTrustArtifact = null;candidate = null;pairing = null;replacing = true;
        connectionContext = java.util.UUID.randomUUID().toString();return connectionState();
    }); }
    @PluginMethod public void resumeEnrollment(PluginCall call) { execute(call, () -> finishEnrollment(false)); }
    @PluginMethod public void beginReplacement(PluginCall call) { execute(call, () -> {
        if (pendingEnrollment != null) throw new IllegalStateException("Resolve the pending enrollment first");
        // Shared UI has settled encrypted writers before this native boundary.
        replacing = true; candidate = null; pairing = null; connectionContext = java.util.UUID.randomUUID().toString();
        return connectionState();
    }); }
    @PluginMethod public void cancel(PluginCall call) { execute(call, () -> { if (pendingEnrollment != null) throw new IllegalStateException("Resolve confirmed enrollment first"); candidate = null; pairing = null; replacing = false; connectionContext = java.util.UUID.randomUUID().toString(); return connectionState(); }); }
    @PluginMethod public void request(PluginCall call) { execute(call, () -> {
        if (active == null || pendingEnrollment != null || replacing) throw new IllegalStateException("Pairing required");
        String requestedContext = call.getString("connectionContext");
        if (!connectionContext.equals(requestedContext)) throw new IllegalStateException("Installation changed");
        allowed(active);
        long generation = revisions.current();
        String path = call.getString("path", "");
        if (path.equals("/api/sessions") || (path.equals("/api/sessions/current") && call.getString("method", "GET").equals("DELETE"))) vault.pendingAuthentication(null);
        var response = managedRequestBytes(active, path, call.getString("method", "GET"), call.getObject("headers", new JSObject()), TrustedConnection.decodeRequestBody(call.getString("bodyBase64")));
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IllegalStateException("Runtime closed");
        allowed(active);
        if (generation != revisions.current()) throw new ManagedFailure("MANAGED_BLOCKED");
        if (!connectionContext.equals(requestedContext)) throw new IllegalStateException("Installation changed");
        vault.write(active);
        JSObject result = new JSObject(); result.put("status", response.status()); result.put("headers", response.headers()); result.put("bodyBase64", response.bodyBase64()); return result;
    }); }
    @PluginMethod public void beginAuthentication(PluginCall call) { execute(call, () -> {
        if (active == null || pendingEnrollment != null || replacing) throw new IllegalStateException("Pairing required");
        allowed(active);
        String purpose = call.getString("purpose", "");
        if (!purpose.equals("login") && !purpose.equals("switch")) throw new IllegalArgumentException("Invalid login purpose");
        String installation = NativeAuthentication.installationIdentity(active.saved(), System.currentTimeMillis());
        // Discard an older native return before beginning a new explicit login.
        vault.pendingAuthentication(null);
        JSONObject headers = new JSONObject().put("content-type", "application/json").put("x-personal-authentication", "1");
        String csrf = call.getString("csrfToken"); if (csrf != null) headers.put("x-csrf-token", csrf);
        var reply = managedRequest(active, "/api/sessions/oidc/native/login", "POST", headers, new JSONObject().put("purpose", purpose).put("returnScheme", getContext().getPackageName() + ".auth").toString());
        vault.write(active); // Persist outgoing session revocation even if provider preparation fails.
        if (reply.status() != 200) throw new IllegalStateException("Sign-in unavailable");
        JSONObject body = new JSONObject(reply.body());
        String secret = body.getString("nativeSecret"), destination = body.getString("authorizationUrl");
        NativeAuthentication.validateStart(active.origin, destination, secret);
        allowed(active);
        long revision = revisions.current();
        vault.pendingAuthentication(new JSONObject().put("secret", secret).put("origin", active.origin)
            .put("trust", NativeAuthentication.connectionIdentity(active.origin, active.caPem)).put("context", policy().context())
            .put("installation", installation));
        // The external browser owns provider pages; none inherits the Capacitor bridge.
        var launched = new java.util.concurrent.CountDownLatch(1);
        var failure = new java.util.concurrent.atomic.AtomicReference<Exception>();
        withReplyRealm(call, () -> {
            try {
                allowed(active);
                if (destroyed || revision != revisions.current()) throw new IllegalStateException("Policy changed");
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(destination));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                getActivity().startActivity(intent);
            } catch (Exception error) { failure.set(error); }
            finally { launched.countDown(); }
        });
        if (!launched.await(10, java.util.concurrent.TimeUnit.SECONDS) || failure.get() != null) {
            vault.pendingAuthentication(null); throw new IllegalStateException("Browser unavailable");
        }
        return new JSObject();
    }); }
    @PluginMethod public void finishAuthentication(PluginCall call) { execute(call, () -> {
        JSObject result = new JSObject(); result.put("outcome", "idle");
        // Preview cancellation preserves the original return; confirmed replacement
        // cannot send or redeem authentication traffic under outgoing authority.
        if (pendingEnrollment != null || replacing) return result;
        JSONObject pending = vault.pendingAuthentication();
        if (pending == null) return result;
        String installation = null;
        if (active != null) {
            try { installation = NativeAuthentication.installationIdentity(active.saved(), System.currentTimeMillis()); }
            catch (IllegalStateException expiredInstallation) { /* Old returns cannot revive an expired enrollment. */ }
        }
        if (active == null || !NativeAuthentication.contextMatches(pending, active.origin, active.caPem, policy().context(), installation)) {
            vault.pendingAuthentication(null); return result;
        }
        var reply = managedRequest(active, "/api/sessions/oidc/native/finish", "POST", new JSONObject().put("content-type", "application/json").put("x-personal-authentication", "1"),
            new JSONObject().put("secret", pending.getString("secret")).toString());
        if (reply.status() != 200) {
            if (reply.status() == 401 || reply.status() == 403) { vault.pendingAuthentication(null); result.put("outcome", "failed"); return result; }
            throw new IllegalStateException("Sign-in return unavailable");
        }
        String outcome = new JSONObject(reply.body()).getString("outcome");
        vault.write(active);
        if (!outcome.equals("waiting")) vault.pendingAuthentication(null);
        result.put("outcome", outcome); return result;
    }); }
    @Override protected void handleOnDestroy() {
        closeReplies();
        destroyed = true;
        if (restrictionReceiver != null) getContext().unregisterReceiver(restrictionReceiver);
        policyObserver.shutdownNow(); executor.shutdownNow(); super.handleOnDestroy();
    }
}
