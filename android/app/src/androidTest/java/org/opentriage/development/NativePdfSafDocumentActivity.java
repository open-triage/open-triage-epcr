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
    private String token, expectedName, expectedSha256;
    private Uri expectedUri;
    private int expectedLength;
    private final Runnable timeout = () -> complete(RESULT_CANCELED,new Bundle(),"picker-timeout");
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        var input=getIntent();receiver=input.getParcelableExtra("result",ResultReceiver.class);
        token=input.getStringExtra("token");expectedName=input.getStringExtra("name");expectedUri=input.getParcelableExtra("document",Uri.class);expectedLength=input.getIntExtra("length",0);expectedSha256=input.getStringExtra("sha256");
        if(!getPackageName().endsWith(".test") || input.getComponent()==null || !getClass().getName().equals(input.getComponent().getClassName())
            || receiver==null || token==null || !token.matches("[a-f0-9-]{36}") || expectedName==null
            || !expectedName.matches("opentriage-synthetic-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.pdf")
            || expectedSha256==null || !expectedSha256.matches("[a-f0-9]{64}")
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
            result.putInt("grantFlags",flags);result.putBoolean("readFlag",(flags&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);result.putBoolean("writeFlag",(flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)!=0);
            boolean content="content".equals(selected.getScheme());result.putBoolean("contentUri",content);
            result.putBoolean("sameAuthority",expectedUri.getAuthority().equals(selected.getAuthority()));result.putBoolean("sameHint",expectedUri.equals(selected));
            boolean sameId=false;try {sameId=DocumentsContract.getDocumentId(expectedUri).equals(DocumentsContract.getDocumentId(selected));}catch(IllegalArgumentException notDocument){ /* Report the failed predicate without reading bytes. */ }
            result.putBoolean("sameDocumentId",sameId);
            // Deliver pure predicates before any provider/system permission RPC,
            // so diagnostics cannot hide the first failing identity condition.
            var progress=new Bundle(result);progress.putString("token",token);progress.putString("progressStage","pure-identity");receiver.send(RESULT_FIRST_USER,progress);
            // DownloadProvider may return another durable ID for the same
            // exported file when the user selects it through OPEN_DOCUMENT.
            // Bind this new grant to the provider, exact metadata and fresh
            // byte digest; the old URI is a location hint, not an ID contract.
            if((flags&grants)!=grants || !content || !expectedUri.getAuthority().equals(selected.getAuthority()))throw new IllegalArgumentException("Unexpected selected document provider/grant");
            String selectedId=DocumentsContract.getDocumentId(selected);
            if(selectedId.isEmpty())throw new IllegalArgumentException("Missing selected document ID");
            boolean readPermission=checkUriPermission(selected,android.os.Process.myPid(),android.os.Process.myUid(),Intent.FLAG_GRANT_READ_URI_PERMISSION)==android.content.pm.PackageManager.PERMISSION_GRANTED;
            boolean writePermission=checkUriPermission(selected,android.os.Process.myPid(),android.os.Process.myUid(),Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==android.content.pm.PackageManager.PERMISSION_GRANTED;
            result.putBoolean("readPermission",readPermission);result.putBoolean("writePermission",writePermission);
            if(!readPermission||!writePermission)throw new SecurityException("Selected document is not currently readable and writable");
            stage="metadata";
            try(var cursor=getContentResolver().query(selected,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
                if(cursor==null||!cursor.moveToFirst())throw new IllegalArgumentException("Document metadata unavailable");
                result.putBoolean("metadataReadable",true);
                boolean documentIdMatches=selectedId.equals(cursor.getString(0));
                boolean nameMatches=expectedName.equals(cursor.getString(1));
                boolean sizeMatches=!cursor.isNull(2)&&cursor.getLong(2)==expectedLength;
                boolean mimeMatches="application/pdf".equals(cursor.getString(3));
                result.putBoolean("selectedDocumentIdMatches",documentIdMatches);result.putBoolean("nameMatches",nameMatches);result.putBoolean("sizeMatches",sizeMatches);result.putBoolean("mimeMatches",mimeMatches);
                if(!documentIdMatches||!nameMatches||!sizeMatches||!mimeMatches||cursor.moveToNext())throw new IllegalArgumentException("Unexpected document metadata");
            }
            stage="read";var digest=java.security.MessageDigest.getInstance("SHA-256");int count=0;
            try(var input=getContentResolver().openInputStream(selected)) {
                if(input==null)throw new java.io.IOException("Document unavailable");int read;
                while((read=input.read(buffer))!=-1){if(completed.get()||read>MAX_BYTES-count)throw new java.io.IOException("Document bound");digest.update(buffer,0,read);count+=read;}
            }
            if(count!=expectedLength)throw new java.io.IOException("Unexpected document length");
            var hex=new StringBuilder();for(byte value:digest.digest()){hex.append(Character.forDigit((value>>>4)&15,16));hex.append(Character.forDigit(value&15,16));}
            result.putInt("length",count);result.putString("sha256",hex.toString());
            if(!expectedSha256.equals(hex.toString()))throw new SecurityException("Selected export does not contain the exact freshly authorized bytes");
            // Never delete a selected document on a metadata/hash failure.
            owned=true;result.putBoolean("identityMatched",true);
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
