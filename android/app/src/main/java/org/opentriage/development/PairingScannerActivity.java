package org.opentriage.development;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.BarcodeView;
import com.journeyapps.barcodescanner.CameraPreview;
import java.util.List;

/** Camera frames are decoded in memory; this activity has no network, file or enrollment access. */
public class PairingScannerActivity extends AppCompatActivity {
    static final String PAYLOAD = "pairing";
    static final String ERROR = "scannerError";
    private BarcodeView camera;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(Activity.RESULT_CANCELED);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left + dp(16), bars.top + dp(8), bars.right + dp(16), bars.bottom + dp(8)); return insets;
        });
        TextView title = new TextView(this); title.setText(R.string.pairing_scanner_title); title.setTextSize(24);
        content.addView(title, new LinearLayout.LayoutParams(-1, -2));
        camera = new BarcodeView(this);
        camera.setDecoderFactory(PairingQrDecoder::cameraDecoder);
        camera.addStateListener(new CameraPreview.StateListener() {
            @Override public void previewSized() {}
            @Override public void previewStarted() {}
            @Override public void previewStopped() {}
            @Override public void cameraClosed() {}
            @Override public void cameraError(Exception error) { setResult(Activity.RESULT_FIRST_USER); finish(); }
        });
        content.addView(camera, new LinearLayout.LayoutParams(-1, 0, 1));
        Button cancel = new Button(this); cancel.setId(R.id.pairing_scan_cancel); cancel.setText(R.string.pairing_scanner_cancel); cancel.setMinHeight(dp(48));
        cancel.setOnClickListener(view -> finish()); content.addView(cancel, new LinearLayout.LayoutParams(-1, -2));
        setContentView(content);
        camera.decodeSingle(new BarcodeCallback() {
            @Override public void barcodeResult(BarcodeResult result) {
                // Validate size before returning across the native bridge; preview performs full trust/enrollment validation.
                String text = result.getText();
                if (text != null && text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= PairingQrDecoder.MAX_BYTES) {
                    setResult(Activity.RESULT_OK, new Intent().putExtra(PAYLOAD, text));
                } else setResult(Activity.RESULT_FIRST_USER, new Intent().putExtra(ERROR, "QR_TOO_LARGE"));
                finish();
            }
            @Override public void possibleResultPoints(List<ResultPoint> points) {}
        });
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onResume() {
        super.onResume();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) { setResult(Activity.RESULT_FIRST_USER); finish(); return; }
        camera.resume();
    }
    @Override public void onPause() { if (camera != null) camera.pause(); super.onPause(); }
}
