package org.opentriage.development;

import static org.junit.Assert.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Uses the real MainActivity, Capacitor reply proxy and bundled WebView. */
@RunWith(AndroidJUnit4.class)
public class NativeReplyLifecycleTest {
    @CapacitorPlugin(name="ReplyProbe")
    public static class ReplyProbe extends LifecycleBoundPlugin {
        static CountDownLatch entered, release, completed;
        static volatile boolean destroyed;
        static volatile int echoes;
        static volatile PluginCall success, failure;
        @PluginMethod public void echo(PluginCall call) { echoes++; resolveCall(call, new JSObject().put("live", true)); }
        @PluginMethod public void hold(PluginCall call) {
            boolean fail=call.getBoolean("fail",false);
            if(fail) failure=call; else success=call;
            new Thread(() -> {
                entered.countDown();
                try {
                    if(!release.await(30,TimeUnit.SECONDS)) throw new AssertionError("Held reply was not released");
                    if(fail) rejectCall(call,"Expected held failure","HELD_FAILURE");
                    else resolveCall(call,new JSObject().put("late",true));
                    notifyListeners("heldEvent",new JSObject().put("late",true),true);
                } catch(InterruptedException error) { Thread.currentThread().interrupt();throw new AssertionError(error); }
                finally { completed.countDown(); }
            },"held-native-reply").start();
        }
        @Override protected void handleOnDestroy() { super.handleOnDestroy();destroyed=true; }
    }
    private String evaluate(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        var value=new AtomicReference<String>();var ready=new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);ready.countDown();}));
        assertTrue("WebView must answer",ready.await(10,TimeUnit.SECONDS));return value.get();
    }
    private void waitFor(ActivityScenario<MainActivity> scenario,String predicate) throws Exception {
        long deadline=System.currentTimeMillis()+45000;
        while(System.currentTimeMillis()<deadline) { if("true".equals(evaluate(scenario,predicate)))return;Thread.sleep(50); }
        fail("Bundled WebView condition timed out: "+predicate+"; echoes="+ReplyProbe.echoes+"; state="+evaluate(scenario,"JSON.stringify({live:window.__replyLive,error:window.__replyError,ready:document.readyState,origin:location.origin,body:document.body.innerText.slice(0,150)})"));
    }
    private ActivityScenario<MainActivity> launch() throws Exception {
        // Activity-result launchers register before STARTED, on the real
        // MainActivity builder before onCreate constructs its Bridge.
        var application=(android.app.Application)InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
        var registration=new android.app.Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityPreCreated(android.app.Activity activity,android.os.Bundle state) {
                if(activity instanceof MainActivity main) main.registerPlugin(ReplyProbe.class);
            }
            @Override public void onActivityCreated(android.app.Activity a,android.os.Bundle b) {}
            @Override public void onActivityStarted(android.app.Activity a) {}
            @Override public void onActivityResumed(android.app.Activity a) {}
            @Override public void onActivityPaused(android.app.Activity a) {}
            @Override public void onActivityStopped(android.app.Activity a) {}
            @Override public void onActivitySaveInstanceState(android.app.Activity a,android.os.Bundle b) {}
            @Override public void onActivityDestroyed(android.app.Activity a) {}
        };
        application.registerActivityLifecycleCallbacks(registration);
        ActivityScenario<MainActivity> scenario;
        try { scenario=ActivityScenario.launch(MainActivity.class); }
        finally { application.unregisterActivityLifecycleCallbacks(registration); }
        waitFor(scenario,"Boolean(window.Capacitor?.nativePromise) && document.readyState==='complete'");
        evaluate(scenario,"window.__replyLive=false;window.Capacitor.nativePromise('ReplyProbe','echo',{}).then(v=>window.__replyLive=v.live).catch(e=>window.__replyError=String(e?.message||e))");
        waitFor(scenario,"window.__replyLive===true");return scenario;
    }
    @Test public void heldWorkerRepliesAfterDestroyAreDiscardedAndNewWebViewRepliesRemainLive() throws Exception {
        int pid=android.os.Process.myPid();
        ReplyProbe.entered=new CountDownLatch(2);ReplyProbe.release=new CountDownLatch(1);ReplyProbe.completed=new CountDownLatch(2);ReplyProbe.destroyed=false;
        var original=launch();
        try {
            evaluate(original,"window.Capacitor.nativeCallback('ReplyProbe','addListener',{eventName:'heldEvent'},()=>{});window.Capacitor.nativePromise('ReplyProbe','hold',{fail:false}).catch(()=>{});window.Capacitor.nativePromise('ReplyProbe','hold',{fail:true}).catch(()=>{})");
            assertTrue("Both real bridge calls must enter while WebView lives",ReplyProbe.entered.await(10,TimeUnit.SECONDS));
            // Pause is not destruction: an ordinary background/foreground transition
            // must keep the same realm capable of receiving authorized live replies.
            original.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            original.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            evaluate(original,"window.__replyLive=false;window.Capacitor.nativePromise('ReplyProbe','echo',{}).then(v=>window.__replyLive=v.live).catch(e=>window.__replyError=String(e?.message||e))");
            waitFor(original,"window.__replyLive===true");
            original.close();assertTrue("The owning plugin must close before releasing workers",ReplyProbe.destroyed);
            ReplyProbe.release.countDown();
            assertTrue("Held success/error/event workers must finish",ReplyProbe.completed.await(10,TimeUnit.SECONDS));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertTrue("Destroyed success callback is released without touching reply proxy",ReplyProbe.success.isReleased());
            assertTrue("Destroyed failure callback is released without touching reply proxy",ReplyProbe.failure.isReleased());
            assertEquals("Native process survives destroyed realm delivery",pid,android.os.Process.myPid());
            try(var replacement=launch()) { assertEquals("New realm independently delivers live replies",pid,android.os.Process.myPid()); }
        } finally { ReplyProbe.release.countDown();original.close(); }
    }
}
