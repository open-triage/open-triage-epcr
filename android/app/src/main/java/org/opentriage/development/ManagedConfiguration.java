package org.opentriage.development;

import android.content.Context;
import android.content.RestrictionsManager;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.UserManager;
import java.util.List;
import org.json.JSONObject;

/** Standard Android policy only. Remember management presence, never a fallback server or credential. */
final class ManagedConfiguration {
    private final RestrictionsManager restrictions;
    private final SharedPreferences preferences;
    private boolean observedManagement;
    ManagedConfiguration(Context context) {
        restrictions = context.getSystemService(RestrictionsManager.class);
        preferences = context.getSharedPreferences("managed-connection-v1", Context.MODE_PRIVATE);
    }
    ManagedConnectionPolicy.State refresh() throws Exception {
        ManagedConnectionPolicy.State state;
        boolean persisted;
        try { persisted = preferences.getBoolean("seen", false); }
        catch (Exception unreadableMarker) {
            state = new ManagedConnectionPolicy.State(observedManagement, "unavailable", null, null, null);
            return state;
        }
        boolean seen = observedManagement || persisted;
        try {
            // Android 14+ can have several policy admins. Conflicting authorities fail closed.
            List<Bundle> bundles = Build.VERSION.SDK_INT >= 34 ? restrictions.getApplicationRestrictionsPerAdmin()
                : List.of(restrictions.getApplicationRestrictions());
            ManagedConnectionPolicy.State selected = null;
            boolean pending = false, conflict = false;
            for (Bundle bundle : bundles) {
                if (bundle.containsKey(UserManager.KEY_RESTRICTIONS_PENDING)) {
                    seen = true;
                    if (!(bundle.get(UserManager.KEY_RESTRICTIONS_PENDING) instanceof Boolean)) conflict = true;
                }
                pending |= bundle.getBoolean(UserManager.KEY_RESTRICTIONS_PENDING, false);
                JSONObject adminValues = new JSONObject();
                for (String key : ManagedConnectionPolicy.KEYS) if (bundle.containsKey(key)) {
                    Object value = bundle.get(key);
                    adminValues.put(key, value == null ? JSONObject.NULL : value);
                }
                if (adminValues.length() > 0) {
                    var adminState = ManagedConnectionPolicy.evaluate(adminValues, false, false);
                    if (adminState.blocked() || selected != null && !selected.context().equals(adminState.context())) conflict = true;
                    if (!adminState.blocked()) selected = adminState;
                }
            }
            state = pending ? ManagedConnectionPolicy.evaluate(new JSONObject(), seen, true)
                : conflict ? new ManagedConnectionPolicy.State(true, "invalid", null, null, null)
                : selected != null ? selected : ManagedConnectionPolicy.evaluate(new JSONObject(), seen, false);
        } catch (Exception unavailable) {
            // Failure to read policy cannot silently make a connection locally editable.
            state = new ManagedConnectionPolicy.State(seen, "unavailable", null, null, null);
        }
        observedManagement |= state.managed();
        if (observedManagement && !persisted && !preferences.edit().putBoolean("seen", true).commit()) {
            state = new ManagedConnectionPolicy.State(true, "unavailable", null, null, null);
        }
        return state;
    }
}
