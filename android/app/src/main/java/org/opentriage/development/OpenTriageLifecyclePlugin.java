package org.opentriage.development;

import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** OS lifecycle only; never persists or emits clinical content or credentials. */
@CapacitorPlugin(name = "OpenTriageLifecycle")
public class OpenTriageLifecyclePlugin extends Plugin {
    private void changed(boolean active) {
        JSObject event = new JSObject(); event.put("active", active);
        notifyListeners("foreground", event, true);
    }
    @PluginMethod public void state(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject state = new JSObject();
            state.put("active", getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED));
            call.resolve(state);
        });
    }
    @Override protected void handleOnPause() { changed(false); }
    @Override protected void handleOnResume() { changed(true); }
}
