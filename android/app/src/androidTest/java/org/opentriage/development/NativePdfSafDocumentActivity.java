package org.opentriage.development;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

/** Separate test-APK user document consumer; never packaged in the clinical APK. */
public final class NativePdfSafDocumentActivity extends Activity {
    private static final int OPEN = 8010, MAX_BYTES = 10 * 1024 * 1024;
    private final java.util.concurrent.atomic.AtomicBoolean completed = new java.util.concurrent.atomic.AtomicBoolean();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private ResultReceiver receiver;
    private String token, expectedName;
    private Uri expectedUri;
    private int expectedLength;
    private final Runnable timeout = () -> complete(RESULT_CANCELED,new Bundle(),"picker-timeout");
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        var input=getIntent();receiver=input.getParcelableExtra("result",ResultReceiver.class);
        token=input.getStringExtra("token");expectedName=input.getStringExtra("name");expectedUri=input.getParcelableExtra("document",Uri.class);expectedLength=input.getIntExtra("length",0);
        if(!getPackageName().endsWith(".test") || input.getComponent()==null || !getClass().getName().equals(input.getComponent().getClassName())
            || receiver==null || token==null || !token.matches("[a-f0-9-]{36}") || expectedName==null
            || !expectedName.matches("opentriage-synthetic-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.pdf")
            || expectedUri==null || !"content".equals(expectedUri.getScheme()) || expectedUri.getAuthority()==null || expectedLength<1 || expectedLength>MAX_BYTES) {
            complete(RESULT_CANCELED,new Bundle(),"invalid-test-request");return;
        }
        try {
            DocumentsContract.getDocumentId(expectedUri);
            Intent open=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                .putExtra(DocumentsContract.EXTRA_INITIAL_URI,expectedUri);
            ui.postDelayed(timeout,30_000);if(state==null)startActivityForResult(open,OPEN);
        } catch(Exception failure){complete(RESULT_CANCELED,new Bundle(),"picker-launch-"+failure.getClass().getSimpleName());}
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if(token!=null&&token.equals(intent.getStringExtra("cancelToken")))complete(RESULT_CANCELED,new Bundle(),"test-cancelled");
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);if(request!=OPEN)return;
        if(result!=RESULT_OK||data==null||data.getData()==null){complete(RESULT_CANCELED,new Bundle(),"picker-cancelled");return;}
        Uri selected=data.getData();int flags=data.getFlags();
        new Thread(()->verify(selected,flags),"synthetic-pdf-document-verifier").start();
    }
    private void verify(Uri selected,int flags) {
        Bundle result=new Bundle();result.putInt("consumerUid",android.os.Process.myUid());result.putString("component",getComponentName().flattenToShortString());
        boolean owned=false;String stage="identity",primary="",cleanup="";
        byte[] buffer=new byte[32768];
        try {
            int grants=Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            if((flags&grants)!=grants || !"content".equals(selected.getScheme()) || !expectedUri.getAuthority().equals(selected.getAuthority())
                || !DocumentsContract.getDocumentId(expectedUri).equals(DocumentsContract.getDocumentId(selected)))throw new IllegalArgumentException("Unexpected selected document");
            stage="metadata";
            try(var cursor=getContentResolver().query(selected,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)) {
                if(cursor==null||!cursor.moveToFirst()||!expectedName.equals(cursor.getString(0)))throw new IllegalArgumentException("Unexpected document metadata");
                owned=true;result.putBoolean("identityMatched",true);
                if(!cursor.isNull(1)&&(cursor.getLong(1)<1||cursor.getLong(1)>MAX_BYTES||cursor.getLong(1)!=expectedLength))throw new IllegalArgumentException("Unexpected document size");
            }
            stage="read";var digest=java.security.MessageDigest.getInstance("SHA-256");int count=0;
            try(var input=getContentResolver().openInputStream(selected)) {
                if(input==null)throw new java.io.IOException("Document unavailable");int read;
                while((read=input.read(buffer))!=-1){if(completed.get()||read>MAX_BYTES-count)throw new java.io.IOException("Document bound");digest.update(buffer,0,read);count+=read;}
            }
            if(count!=expectedLength)throw new java.io.IOException("Unexpected document length");
            var hex=new StringBuilder();for(byte value:digest.digest()){hex.append(Character.forDigit((value>>>4)&15,16));hex.append(Character.forDigit(value&15,16));}
            result.putInt("length",count);result.putString("sha256",hex.toString());
        } catch(Exception failure){primary=stage+":"+failure.getClass().getSimpleName();}
        finally {
            java.util.Arrays.fill(buffer,(byte)0);
            if(owned)try {if(!DocumentsContract.deleteDocument(getContentResolver(),selected))throw new java.io.IOException("Delete rejected");result.putBoolean("deleted",true);}
            catch(Exception failure){cleanup=failure.getClass().getSimpleName();}
            result.putString("primaryFailure",primary);result.putString("cleanupFailure",cleanup);
            complete(primary.isEmpty()&&cleanup.isEmpty()&&result.getBoolean("deleted")?RESULT_OK:RESULT_CANCELED,result,"");
        }
    }
    private void complete(int code,Bundle result,String error) {
        if(!completed.compareAndSet(false,true))return;
        result.putString("token",token);if(!error.isEmpty())result.putString("primaryFailure",error);
        runOnUiThread(()->{ui.removeCallbacksAndMessages(null);finishActivity(OPEN);if(receiver!=null)receiver.send(code,result);finish();});
    }
    @Override protected void onDestroy(){completed.set(true);ui.removeCallbacksAndMessages(null);super.onDestroy();}
}
