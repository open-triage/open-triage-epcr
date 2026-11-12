package org.opentriage.development;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.PermissionCallback;

/** All app-owned native replies/events share the WebView's UI-thread lifetime. */
public abstract class LifecycleBoundPlugin extends Plugin {
    private WebView replyRealm;
    private final Handler replyUi = new Handler(Looper.getMainLooper());
    private final NativeReplyGate replies = new NativeReplyGate(
        task -> replyUi.post(task), () -> Looper.myLooper() == Looper.getMainLooper(),
        () -> replyRealm != null && getBridge().getWebView() == replyRealm && !getActivity().isDestroyed());
    @Override public final void load() {
        Runnable bind = () -> {
            // Registration may originate on a Capacitor worker. Inspect the
            // Activity/WebView and register resources only on its UI thread.
            if (getActivity().isDestroyed()) { replies.close(); return; }
            replyRealm = getBridge().getWebView();
            onReplyRealmReady();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) bind.run(); else replyUi.post(bind);
    }
    protected void onReplyRealmReady() { super.load(); }
    protected final void resolveCall(PluginCall call, JSObject value) {
        replies.dispatch(() -> call.resolve(value), () -> call.release(getBridge()));
    }
    protected final void rejectCall(PluginCall call, String message, String code) {
        replies.dispatch(() -> call.reject(message, code), () -> call.release(getBridge()));
    }
    @Override protected final void notifyListeners(String event, JSObject value, boolean retainUntilConsumed) {
        replies.dispatch(() -> super.notifyListeners(event, value, retainUntilConsumed), () -> {});
    }
    @Override protected final void notifyListeners(String event, JSObject value) {
        notifyListeners(event, value, false);
    }
    protected final void withReplyRealm(PluginCall call, Runnable operation) {
        replies.dispatch(operation, () -> call.release(getBridge()));
    }
    @Override @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public final void addListener(PluginCall call) { withReplyRealm(call, () -> super.addListener(call)); }
    @Override @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public final void removeListener(PluginCall call) { withReplyRealm(call, () -> super.removeListener(call)); }
    @Override @PluginMethod
    public final void removeAllListeners(PluginCall call) { withReplyRealm(call, () -> super.removeAllListeners(call)); }
    @Override @PluginMethod @PermissionCallback
    public final void checkPermissions(PluginCall call) { withReplyRealm(call, () -> super.checkPermissions(call)); }
    @Override @PluginMethod
    public final void requestPermissions(PluginCall call) { withReplyRealm(call, () -> super.requestPermissions(call)); }
    /** Must precede cancellation, whose callbacks may complete synchronously. */
    protected final void closeReplies() { replies.close(); }
    @Override protected void handleOnDestroy() { closeReplies(); super.handleOnDestroy(); }
}
