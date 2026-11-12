package org.opentriage.development;
import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Real vault/bridge proof: stale JS metadata never supplies native personal authority. */
public class NativeTransitionResumeTest {
 private String evaluate(ActivityScenario<MainActivity> activity,String script)throws Exception{
  var result=new AtomicReference<String>();var done=new CountDownLatch(1);
  activity.onActivity(screen->screen.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));
  assertTrue(done.await(10,TimeUnit.SECONDS));return result.get();
 }
 private void waitFor(ActivityScenario<MainActivity> activity,String expression)throws Exception{
  long deadline=android.os.SystemClock.elapsedRealtime()+15000;
  while(android.os.SystemClock.elapsedRealtime()<deadline){if("true".equals(evaluate(activity,expression)))return;Thread.sleep(50);}fail("Native transition proof did not settle");
 }
 private void rpc(ActivityScenario<MainActivity> activity,String options)throws Exception{
  evaluate(activity,"window.__resumeResult=null;window.Capacitor.nativePromise('OpenTriageConnection','reconcileTransition',"+options+").then(value=>window.__resumeResult={value}).catch(error=>window.__resumeResult={error:error.code||'rejected'})");
  waitFor(activity,"Boolean(window.__resumeResult)");
 }
 private void pendingHandoffRejectsPdfLaunchAndRevokesLiveAuthority(ActivityScenario<MainActivity> activity,Context context)throws Exception{
  var plugin=new AtomicReference<OpenTriageConnectionPlugin>();activity.onActivity(screen->plugin.set((OpenTriageConnectionPlugin)screen.getBridge().getPlugin("OpenTriageConnection").getInstance()));
  var instance=plugin.get();var executorField=OpenTriageConnectionPlugin.class.getDeclaredField("executor");executorField.setAccessible(true);
  var executor=(java.util.concurrent.ExecutorService)executorField.get(instance);
  var activeField=OpenTriageConnectionPlugin.class.getDeclaredField("active");activeField.setAccessible(true);var connection=(TrustedConnection)activeField.get(instance);
  var contextField=OpenTriageConnectionPlugin.class.getDeclaredField("connectionContext");contextField.setAccessible(true);String scope=(String)contextField.get(instance);
  var pendingField=OpenTriageConnectionPlugin.class.getDeclaredField("pendingHandoff");pendingField.setAccessible(true);Object pending=pendingField.get(instance);assertNotNull(pending);
  var network=new java.util.concurrent.atomic.AtomicInteger();var viewers=new java.util.concurrent.atomic.AtomicInteger();
  var oldPolicy=new AtomicReference<android.os.StrictMode.ThreadPolicy>();
  androidx.test.runner.lifecycle.ActivityLifecycleCallback observer=(screen,stage)->{if(screen instanceof NativePdfActivity&&stage==androidx.test.runner.lifecycle.Stage.CREATED)viewers.incrementAndGet();};
  var instrumentation=InstrumentationRegistry.getInstrumentation();
  instrumentation.runOnMainSync(()->androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(observer));
  Object owner=new Object();String id=java.util.UUID.randomUUID().toString();
  try{
   executor.submit(()->{oldPolicy.set(android.os.StrictMode.getThreadPolicy());android.os.StrictMode.setThreadPolicy(new android.os.StrictMode.ThreadPolicy.Builder().detectNetwork().penaltyListener(Runnable::run,violation->network.incrementAndGet()).build());}).get(5,TimeUnit.SECONDS);
   // A live session uses the same production predicate as the launch gate.
   executor.submit(()->{try{pendingField.set(instance,null);}catch(Exception failure){throw new AssertionError(failure);}}).get(5,TimeUnit.SECONDS);
   NativePdfSessions.begin(owner,id);var loads=new java.util.concurrent.atomic.AtomicInteger();
   var session=NativePdfSessions.create(context,owner,id,System.currentTimeMillis()+60_000,()->instance.pdfConnectionCurrent(connection,scope),()->{loads.incrementAndGet();return NativePdfFixture.bytes();});
   var file=session.cache(NativePdfFixture.bytes());assertTrue(session.current());
   executor.submit(()->{try{pendingField.set(instance,pending);}catch(Exception failure){throw new AssertionError(failure);}}).get(5,TimeUnit.SECONDS);
   session.reassess();assertFalse("A staged handoff revokes the original live PDF authority",session.current());assertFalse(file.exists());assertNull(NativePdfSessions.get(id));
   assertThrows(IllegalStateException.class,session::fresh);assertEquals(0,loads.get());
   evaluate(activity,"window.__pdfHandoffResult=null;window.Capacitor.nativePromise('OpenTriageConnection','openPdf',{operationId:'"+java.util.UUID.randomUUID()+"',connectionContext:window.__nativeState.connectionContext,path:'/api/reports/11111111-1111-4111-8111-111111111111/cos/pdf?revision=0&language=en',headers:{'x-organization-id':'22222222-2222-4222-8222-222222222222'},language:'en',action:'view',accent:''}).then(value=>window.__pdfHandoffResult={value}).catch(error=>window.__pdfHandoffResult={error:error.code||'rejected'})");
   waitFor(activity,"Boolean(window.__pdfHandoffResult)");assertEquals("true",evaluate(activity,"Boolean(window.__pdfHandoffResult.error)"));
   assertEquals("Pending handoff is rejected before any network operation",0,network.get());assertEquals("Pending handoff never opens a PDF Activity",0,viewers.get());
  }finally{
   NativePdfSessions.closeOwner(owner);
   executor.submit(()->{try{pendingField.set(instance,pending);}catch(Exception failure){throw new AssertionError(failure);}finally{if(oldPolicy.get()!=null)android.os.StrictMode.setThreadPolicy(oldPolicy.get());}}).get(5,TimeUnit.SECONDS);
   instrumentation.runOnMainSync(()->androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(observer));
  }
 }
 private void personalRpc(ActivityScenario<MainActivity> activity,String options)throws Exception{
  evaluate(activity,"window.__personalResult=null;window.Capacitor.nativePromise('OpenTriageConnection','resumePersonalSession',"+options+").then(value=>window.__personalResult={value}).catch(error=>window.__personalResult={error:error.code||'rejected'})");
  waitFor(activity,"Boolean(window.__personalResult)");
 }
 @Test public void nativeReconciliationRequiresSettledContextAndHonorsExplicitLogout()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();var prefs=context.getSharedPreferences("connection-v1",Context.MODE_PRIVATE);prefs.edit().clear().commit();
  var vault=new ConnectionVault(context);
  try{
   try(var initial=ActivityScenario.launch(MainActivity.class)){
    waitFor(initial,"Boolean(window.Capacitor?.nativePromise)");
    evaluate(initial,"localStorage.setItem('open-triage.installation-transition.v1','handoff:native-test');localStorage.setItem('open-triage.installation-generation.v1','handoff:native-test')");
   }
   long expiry=System.currentTimeMillis()+3600000;
   JSONObject saved=new TrustedConnection("https://transition.invalid","").saved().put("cookies",new JSONArray()
    .put(new JSONObject().put("name","open_triage_installation").put("value","I".repeat(43)).put("expires",expiry))
    .put(new JSONObject().put("name","open_triage_session").put("value","P".repeat(43)).put("expires",expiry)));
   vault.write(TrustedConnection.restore(saved));
   var session=new JSONObject().put("csrfToken","C".repeat(43)).put("user",new JSONObject().put("id","original-user")).put("organization",JSONObject.NULL);
   vault.savePersonalContinuation(vault.read(),session);vault.pendingAuthentication(new JSONObject().put("secret","synthetic-old-return"));
   try(var activity=ActivityScenario.launch(MainActivity.class)){
    waitFor(activity,"Boolean(window.Capacitor?.nativePromise)");
    evaluate(activity,"window.__nativeState=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(value=>window.__nativeState=value)");waitFor(activity,"Boolean(window.__nativeState)");
    String before=prefs.getString("encrypted",null);
    personalRpc(activity,"{connectionContext:window.__nativeState.connectionContext}");assertEquals("true",evaluate(activity,"Boolean(window.__personalResult.value&&!window.__personalResult.value.session)"));assertEquals(before,prefs.getString("encrypted",null));assertNotNull(vault.pendingAuthentication());
    rpc(activity,"{connectionContext:'wrong-context',purpose:'logout'}");assertEquals("true",evaluate(activity,"Boolean(window.__resumeResult.error)"));assertEquals(before,prefs.getString("encrypted",null));assertNotNull(vault.pendingAuthentication());
    rpc(activity,"{connectionContext:window.__nativeState.connectionContext,purpose:'enrollment'}");assertEquals("true",evaluate(activity,"Boolean(window.__resumeResult.value?.configured)"));assertEquals(2,vault.read().saved().getJSONArray("cookies").length());assertNull(vault.pendingAuthentication());
    evaluate(activity,"window.__nativeState=window.__resumeResult.value");
    personalRpc(activity,"{connectionContext:'wrong-context'}");assertEquals("true",evaluate(activity,"Boolean(window.__personalResult.error)"));assertNotNull(vault.personalContinuation());
    rpc(activity,"{connectionContext:window.__nativeState.connectionContext,purpose:'logout'}");assertEquals(1,vault.read().saved().getJSONArray("cookies").length());assertEquals("open_triage_installation",vault.read().saved().getJSONArray("cookies").getJSONObject(0).getString("name"));assertEquals("https://transition.invalid",vault.read().origin);
    assertNull(vault.personalContinuation());
   }
   JSONObject pending=new JSONObject().put("candidate",TrustedConnection.restore(saved).installationOnly().saved()).put("body",new JSONObject().put("token","T".repeat(43))).put("createdAt",System.currentTimeMillis());vault.stage(TrustedConnection.restore(saved).installationOnly(),pending);vault.pendingAuthentication(new JSONObject().put("secret","must-remain-pending"));
   try(var activity=ActivityScenario.launch(MainActivity.class)){
    waitFor(activity,"Boolean(window.Capacitor?.nativePromise)");evaluate(activity,"window.__nativeState=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(value=>window.__nativeState=value)");waitFor(activity,"Boolean(window.__nativeState)");
    String before=prefs.getString("encrypted",null);rpc(activity,"{connectionContext:window.__nativeState.connectionContext,purpose:'logout'}");assertEquals("true",evaluate(activity,"Boolean(window.__resumeResult.error)"));assertEquals(before,prefs.getString("encrypted",null));assertEquals(pending.toString(),vault.pending().toString());assertNotNull(vault.pendingAuthentication());
    personalRpc(activity,"{connectionContext:window.__nativeState.connectionContext}");assertEquals("true",evaluate(activity,"Boolean(window.__personalResult.value&&!window.__personalResult.value.session)"));assertEquals(before,prefs.getString("encrypted",null));assertNull(vault.personalContinuation());
   }
   JSONObject handoff=new JSONObject().put("phase","prepared").put("context","pending-context");
   vault.promoteHandoff(TrustedConnection.restore(saved));vault.savePersonalContinuation(vault.read(),session);vault.stageHandoff(TrustedConnection.restore(saved),handoff);vault.pendingAuthentication(new JSONObject().put("secret","must-remain-handoff"));assertNull(vault.pending());
   try(var activity=ActivityScenario.launch(MainActivity.class)){
    waitFor(activity,"Boolean(window.Capacitor?.nativePromise)");evaluate(activity,"window.__nativeState=null;window.Capacitor.nativePromise('OpenTriageConnection','state',{}).then(value=>window.__nativeState=value)");waitFor(activity,"Boolean(window.__nativeState)");
    String before=prefs.getString("encrypted",null);rpc(activity,"{connectionContext:window.__nativeState.connectionContext,purpose:'logout'}");assertEquals("true",evaluate(activity,"Boolean(window.__resumeResult.error)"));assertEquals(before,prefs.getString("encrypted",null));assertEquals(handoff.toString(),vault.pendingHandoff().toString());assertNull(vault.pending());assertNotNull(vault.pendingAuthentication());
    pendingHandoffRejectsPdfLaunchAndRevokesLiveAuthority(activity,context);assertEquals("Blocked PDF cannot rewrite the native vault",before,prefs.getString("encrypted",null));assertEquals(handoff.toString(),vault.pendingHandoff().toString());
    vault.pendingAuthentication(null);personalRpc(activity,"{connectionContext:window.__nativeState.connectionContext}");assertEquals("true",evaluate(activity,"Boolean(window.__personalResult.value&&!window.__personalResult.value.session)"));assertEquals(before,prefs.getString("encrypted",null));assertNotNull(vault.personalContinuation());assertEquals(handoff.toString(),vault.pendingHandoff().toString());assertNull(vault.pendingAuthentication());
    evaluate(activity,"localStorage.removeItem('open-triage.installation-transition.v1');localStorage.removeItem('open-triage.installation-generation.v1')");
   }
  }finally{prefs.edit().clear().commit();}
 }
}
