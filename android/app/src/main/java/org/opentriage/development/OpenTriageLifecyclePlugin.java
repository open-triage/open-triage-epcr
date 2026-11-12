package org.opentriage.development;

import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** OS lifecycle only; never persists or emits clinical content or credentials. */
@CapacitorPlugin(name = "OpenTriageLifecycle")
public class OpenTriageLifecyclePlugin extends LifecycleBoundPlugin {
    @Override protected void onReplyRealmReady() {
        super.onReplyRealmReady();
        getActivity().runOnUiThread(() -> getActivity().getOnBackPressedDispatcher().addCallback(
            getActivity(), new androidx.activity.OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    var view = getActivity().getWindow().getDecorView();
                    var insets = androidx.core.view.ViewCompat.getRootWindowInsets(view);
                    if (insets != null && insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime())) {
                        androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), view)
                            .hide(androidx.core.view.WindowInsetsCompat.Type.ime());
                        return;
                    }
                    // No history navigation or retained Back events across identity changes.
                    notifyListeners("back", new JSObject());
                }
            }));
    }
    @PluginMethod public void background(PluginCall call) {
        withReplyRealm(call, () -> { getActivity().moveTaskToBack(true); resolveCall(call); });
    }
    private void changed(boolean active) {
        JSObject event = new JSObject(); event.put("active", active);
        notifyListeners("foreground", event, true);
    }
    @PluginMethod public void state(PluginCall call) {
        withReplyRealm(call, () -> {
            JSObject state = new JSObject();
            state.put("active", getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED));
            resolveCall(call, state);
        });
    }
    @Override protected void handleOnPause() { changed(false); }
    @Override protected void handleOnResume() { changed(true); }
}
