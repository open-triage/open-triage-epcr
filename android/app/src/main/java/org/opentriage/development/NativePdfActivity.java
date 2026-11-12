package org.opentriage.development;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.Executors;

/** Local platform renderer. No WebView, exported URI, credentials or remote navigation. */
public final class NativePdfActivity extends Activity {
    private static final int SAVE_DOCUMENT = 1901;
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private NativePdfSessions.Session session;
    private PdfRenderer renderer;
    private Bitmap bitmap;
    private ImageView image;
    private TextView status, pageLabel;
    private TextView title;
    private LinearLayout root;
    private final java.util.List<Button> controls = new java.util.ArrayList<>();
    private Button previous, next, save, retry, zoomIn, zoomOut;
    private volatile boolean stopped = true, ended;
    private volatile int generation;
    private volatile boolean picking;
    private boolean saveOnly;
    private Uri pendingDestination;
    private int pageIndex, pages;
    private float zoom = 1;
    private android.content.res.Resources localizedResources;
    private final java.util.concurrent.atomic.AtomicBoolean pollQueued = new java.util.concurrent.atomic.AtomicBoolean();
    private final Runnable serverWatch = new Runnable() {
        @Override public void run() {
            if (ended || stopped || picking || session == null) return;
            if (pollQueued.compareAndSet(false,true)) worker.execute(() -> {
                try { if (!ended && !stopped && !picking) session.reassess(); }
                finally { pollQueued.set(false); }
            });
            ui.postDelayed(this,30_000);
        }
    };
    @Override public android.content.res.Resources getResources() { return localizedResources == null ? super.getResources() : localizedResources; }
    private final Runnable authorityWatch = new Runnable() {
        @Override public void run() {
            if (ended) return;
            if (session == null || !session.current()) {
                // Retain only the picker result receiver after revocation, so
                // an empty destination selected late can still be cancelled.
                if (picking && session != null) session.close();
                else { finish(); return; }
            }
            ui.postDelayed(this, 250);
        }
    };
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        updateLocale(super.getResources().getConfiguration());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        session = NativePdfSessions.get(getIntent().getStringExtra("document"));
        if (session == null || !session.current()) { finish(); return; }
        session.onClosed = () -> ui.post(() -> { if (!ended && !picking) finish(); });
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(12 * getResources().getDisplayMetrics().density); root.setPadding(padding, padding, padding, padding);
        title = new TextView(this); title.setText(R.string.pdf_title); title.setTextSize(20); root.addView(title);
        LinearLayout actions = new LinearLayout(this); actions.setGravity(Gravity.CENTER_VERTICAL);
        Button close = button(R.string.pdf_close, view -> finish()); actions.addView(close,new LinearLayout.LayoutParams(0,-2,1));
        save = button(R.string.pdf_save, view -> chooseDestination()); actions.addView(save,new LinearLayout.LayoutParams(0,-2,1));
        retry = button(R.string.pdf_retry, view -> { retry.setVisibility(View.GONE);save.setVisibility(View.VISIBLE);clearVisible();if(saveOnly)chooseDestination();else render(); });
        retry.setVisibility(View.GONE); actions.addView(retry,new LinearLayout.LayoutParams(0,-2,1)); root.addView(actions);
        status = new TextView(this); status.setText(R.string.pdf_loading); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(status);
        pageLabel = new TextView(this); pageLabel.setGravity(Gravity.CENTER); pageLabel.setTextSize(16); root.addView(pageLabel);
        LinearLayout navigation = new LinearLayout(this); navigation.setGravity(Gravity.CENTER_VERTICAL);
        previous = icon(R.string.pdf_previous_symbol,R.string.pdf_previous, view -> { if (pageIndex > 0) { pageIndex--; render(); } });
        next = icon(R.string.pdf_next_symbol,R.string.pdf_next, view -> { if (pageIndex + 1 < pages) { pageIndex++; render(); } });
        zoomOut = icon(R.string.pdf_zoom_out_symbol,R.string.pdf_zoom_out, view -> { zoom = Math.max(1, zoom - .5f); render(); });
        zoomIn = icon(R.string.pdf_zoom_in_symbol,R.string.pdf_zoom_in, view -> { zoom = Math.min(4, zoom + .5f); render(); });
        for (Button control : new Button[]{previous,zoomOut,zoomIn,next}) navigation.addView(control,new LinearLayout.LayoutParams(0,-2,1)); root.addView(navigation);
        ScrollView scroll = new ScrollView(this); android.widget.HorizontalScrollView horizontal = new android.widget.HorizontalScrollView(this);
        image = new ImageView(this); image.setAdjustViewBounds(false); horizontal.addView(image); scroll.addView(horizontal); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        saveOnly = getIntent().getBooleanExtra("save", false);
        String accent = getIntent().getStringExtra("accent");
        if (accent != null && accent.matches("#[a-fA-F0-9]{6}")) {
            int color = Color.parseColor(accent); save.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));
            double luminance = .2126 * Color.red(color) + .7152 * Color.green(color) + .0722 * Color.blue(color);
            save.setTextColor(luminance > 150 ? Color.BLACK : Color.WHITE);
        }
        ui.post(authorityWatch);
    }
    private Button button(int text, View.OnClickListener action) {
        Button button = new Button(this); button.setText(text); button.setTextSize(16);
        button.setAllCaps(false); button.setMinWidth(0);
        button.setMinHeight(Math.round(44 * getResources().getDisplayMetrics().density)); button.setOnClickListener(action);controls.add(button);return button;
    }
    private Button icon(int symbol,int label,View.OnClickListener action) { Button button=button(symbol,action);button.setContentDescription(getString(label));return button; }
    private void updateLocale(android.content.res.Configuration input) {
        var configuration = new android.content.res.Configuration(input);
        configuration.setLocale(java.util.Locale.forLanguageTag("sv".equals(getIntent().getStringExtra("language")) ? "sv" : "en"));
        localizedResources = getBaseContext().createConfigurationContext(configuration).getResources();
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        updateLocale(configuration);super.onConfigurationChanged(configuration);
        if(root!=null){int padding=Math.round(12*getResources().getDisplayMetrics().density);root.setPadding(padding,padding,padding,padding);}
        for(Button button:controls){button.setTextSize(16);button.setMinHeight(Math.round(44*getResources().getDisplayMetrics().density));}
        if(title!=null)title.setTextSize(20);if(status!=null)status.setTextSize(16);if(pageLabel!=null)pageLabel.setTextSize(16);
        render();
    }
    @Override protected void onResume() {
        super.onResume(); stopped = false;
        if (session == null || !session.current()) {
            Uri cancelled = pendingDestination; pendingDestination = null;
            if (cancelled != null) worker.execute(() -> {
                try { DocumentsContract.deleteDocument(getContentResolver(),cancelled); } catch (Exception ignored) { /* Never report a cancelled export as saved. */ }
            });
            finish(); return;
        }
        if (pendingDestination != null) { Uri destination = pendingDestination; pendingDestination = null; export(destination); }
        else if (!picking) {
            if (saveOnly && getIntent().getBooleanExtra("save", false)) { getIntent().removeExtra("save"); chooseDestination(); }
            else render();
        }
        ui.removeCallbacks(serverWatch);ui.post(serverWatch);
    }
    private void render() {
        if (ended || stopped || session == null || !session.current()) return;
        int expected = ++generation; int requestedPage = pageIndex; float requestedZoom = zoom;
        status.setVisibility(View.VISIBLE);status.setText(R.string.pdf_loading);save.setEnabled(false);previous.setEnabled(false);next.setEnabled(false);zoomIn.setEnabled(false);zoomOut.setEnabled(false);
        worker.execute(() -> {
            Bitmap rendered = null;
            try {
                session.requireCurrent(); if (stopped || expected != generation) return;
                if (renderer == null) renderer = new PdfRenderer(ParcelFileDescriptor.open(session.preview(), ParcelFileDescriptor.MODE_READ_ONLY));
                int count = renderer.getPageCount(); if (count < 1 || count > 500) throw new IllegalStateException("PDF page bound");
                int shownPage = Math.min(requestedPage,count-1);
                try (PdfRenderer.Page page = renderer.openPage(shownPage)) {
                    int base = Math.max(1, Math.min(2048, getResources().getDisplayMetrics().widthPixels-root.getPaddingLeft()-root.getPaddingRight()));
                    double scale = Math.min((double) base * requestedZoom / page.getWidth(), Math.sqrt(4_000_000d / ((double) page.getWidth() * page.getHeight())));
                    int width = Math.max(1, (int) (page.getWidth() * scale)), height = Math.max(1, (int) (page.getHeight() * scale));
                    rendered = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888); rendered.eraseColor(Color.WHITE);
                    page.render(rendered, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                }
                session.requireCurrent(); Bitmap ready = rendered; rendered = null;
                ui.post(() -> {
                    if (ended || stopped || expected != generation || !session.current()) { ready.recycle(); return; }
                    image.setImageDrawable(null); if (bitmap != null) bitmap.recycle(); bitmap = ready; image.setImageBitmap(ready);
                    image.getLayoutParams().width = ready.getWidth(); image.getLayoutParams().height = ready.getHeight(); image.requestLayout();
                    pages=count;pageIndex=shownPage;
                    String label = getString(R.string.pdf_page, shownPage + 1, count); pageLabel.setText(label); image.setContentDescription(label);
                    previous.setEnabled(shownPage > 0); next.setEnabled(shownPage + 1 < count);zoomIn.setEnabled(zoom<4);zoomOut.setEnabled(zoom>1);save.setEnabled(true);status.setVisibility(View.GONE);
                });
            } catch (Exception error) { showFailure(expected); }
            finally { if (rendered != null) rendered.recycle(); }
        });
    }
    private void chooseDestination() {
        if (session == null || !session.current()) { finish(); return; }
        picking = true;
        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf");
            intent.putExtra(Intent.EXTRA_TITLE, getString(R.string.pdf_file_name)); startActivityForResult(intent, SAVE_DOCUMENT);
        } catch (android.content.ActivityNotFoundException error) { picking = false; status.setText(R.string.pdf_save_failed); }
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SAVE_DOCUMENT) return;
        picking = false;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) pendingDestination = data.getData();
        else if (saveOnly) finish();
    }
    private void export(Uri destination) {
        int expected = ++generation; status.setText(R.string.pdf_loading); save.setEnabled(false);
        worker.execute(() -> {
            try {
                if (!"content".equals(destination.getScheme()) || destination.getAuthority() == null) throw new IllegalArgumentException("Unapproved document destination");
                var provider = getPackageManager().resolveContentProvider(destination.getAuthority(), 0);
                if (provider != null && provider.applicationInfo.uid == getApplicationInfo().uid) throw new IllegalArgumentException("Private app files are not export destinations");
                NativePdfExport.write(session::fresh, bytes -> {
                    // The direct Save action must validate the freshly authorized document too.
                    java.io.File fresh = session.cache(bytes.clone());
                    try (PdfRenderer parsed = new PdfRenderer(ParcelFileDescriptor.open(fresh, ParcelFileDescriptor.MODE_READ_ONLY))) {
                        if (parsed.getPageCount() < 1 || parsed.getPageCount() > 500) throw new IllegalStateException("PDF page bound");
                    }
                }, () -> !ended && !stopped && expected == generation && session.current(), new NativePdfExport.Destination() {
                    @Override public java.io.OutputStream open() throws Exception { return getContentResolver().openOutputStream(destination, "wt"); }
                    @Override public void delete() throws Exception { DocumentsContract.deleteDocument(getContentResolver(), destination); }
                });
                ui.post(() -> {
                    if (!ended && expected == generation && session.current()) {
                        android.widget.Toast.makeText(this,R.string.pdf_saved,android.widget.Toast.LENGTH_SHORT).show();
                        if (saveOnly) { setResult(RESULT_OK,new Intent().setData(destination).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); finish(); }
                        else {save.setEnabled(true);render();}
                    }
                });
            } catch (Exception error) {
                showFailure(expected);
            } finally { session.clearPreview(); }
        });
    }
    private void showFailure(int expected) {
        ui.post(() -> { if (!ended && !stopped && expected == generation) { status.setVisibility(View.VISIBLE);status.setText(R.string.pdf_save_failed);save.setVisibility(View.GONE);retry.setVisibility(View.VISIBLE); } });
    }
    private void clearVisible() {
        generation++; image.setImageDrawable(null); if (bitmap != null) { bitmap.recycle(); bitmap = null; }
        // Renderer work and its close share one worker; the UI never waits on native PDF parsing or TLS.
        worker.execute(() -> { try { closeRenderer(); } finally { if (session != null) session.clearPreview(); } });
    }
    private void closeRenderer() {
        // A failed/closed native handle cannot poison Retry or prevent cleanup.
        PdfRenderer previous=renderer;renderer=null;
        if(previous!=null)try {previous.close();}catch(RuntimeException alreadyInvalid){ /* The handle is discarded; private bytes are still cleared by the caller. */ }
    }
    @Override protected void onStop() {
        stopped = true;
        ui.removeCallbacks(serverWatch);
        // Revoke before deleting bytes: Activity destruction may be deferred
        // after Home, and a stale handle must never recreate the private file.
        if (!picking && session != null) session.close();
        if (image != null) clearVisible();
        if (!picking) finish();
        super.onStop();
    }
    @Override protected void onDestroy() {
        ended = true; stopped = true; generation++; ui.removeCallbacksAndMessages(null);
        if (image != null) image.setImageDrawable(null); if (bitmap != null) { bitmap.recycle(); bitmap = null; }
        if (session != null) session.close();
        worker.execute(this::closeRenderer); worker.shutdown();
        super.onDestroy();
    }
}
