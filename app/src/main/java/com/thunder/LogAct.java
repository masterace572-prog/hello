package com.ryzen;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import android.Manifest;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.DialogInterface;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Message;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.io.File;
import java.io.FileOutputStream;
import java.util.UUID;

import java.security.MessageDigest;

import com.ryzen.utils.Downtwo;
import com.ryzen.utils.Prefs;

import org.lsposed.lsparanoid.Obfuscate;

// No BlackBox imports needed in LogAct - ye file sirf login handle karti hai

@Obfuscate
public class LogAct extends AppCompatActivity {

    static {
        try {
            System.loadLibrary("ryzen");
        } catch (UnsatisfiedLinkError ignored) {
        }
    }

    private Prefs prefs;
    private final String USER = "USER";

    // Must match APP_VERSION in app/src/main/jni/main.cpp
    private static final String APP_VERSION = "1.0";

    private EditText textUsername;
    private Button btnLogin;
    private ImageView pasteBtn;
    private View getKey;
    private File loaderKeyFile;
    private Dialog loadingDialog;

    // App (APK) update state
    private Dialog updateDialog;
    private ProgressBar updateProgress;
    private TextView updateProgressText;
    private File pendingApkFile;
    private String pendingApkUrl;
    private boolean updatePromptShown = false;


    // --- Permissions
    private static final int REQUEST_MANAGE_STORAGE_PERMISSION = 100;
    private static final int REQUEST_MANAGE_UNKNOWN_APP_SOURCES = 200;
    private static final int REQUEST_INSTALL_UPDATE_PERMISSION = 300;
    private static final String PREFS_NAME = "com.ryzen.prefs";
    private static final String PREF_PERMISSIONS_GRANTED = "permissions_granted";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);


        // VPN check before showing UI
        if (iskokofm()) {
            new AlertDialog.Builder(LogAct.this)
                    .setTitle("VPN Detected")
                    .setMessage("Please disable VPN to continue")
                    .setPositiveButton("OK", null)
                    .show();
            return;
        }

        setContentView(R.layout.activity_login);

        prefs = new Prefs(this);

        // Check permissions
        checkAndRequestPermissions();

        textUsername = findViewById(R.id.userkey);
        btnLogin = findViewById(R.id.login);
        pasteBtn = findViewById(R.id.paste);
        getKey = findViewById(R.id.GetKey);

        // Restore saved key
        textUsername.setText(prefs.getSt(USER, ""));

        // Get Key link
        getKey.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(GetKey()));
            startActivity(intent);
        });

        // Login button
        btnLogin.setOnClickListener(v -> {
            String userKey = textUsername.getText().toString().trim();
            if (!userKey.isEmpty()) {
                if (iskokofm()) {
                    new AlertDialog.Builder(LogAct.this)
                            .setTitle("VPN Detected")
                            .setMessage("Please disable VPN to continue")
                            .setPositiveButton("OK", null)
                            .show();
                    return;
                }
                prefs.setSt(USER, userKey);
                Login(this, userKey);
            } else {
                textUsername.setError("Please enter key");
            }
        });

        // Paste button
        pasteBtn.setOnClickListener(v -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clipboard != null && clipboard.hasPrimaryClip()) {
                ClipData clip = clipboard.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence clipText = clip.getItemAt(0).coerceToText(this);
                    String pasted = clipText != null ? clipText.toString() : "";
                    if (pasted.length() > 5) {
                        textUsername.setText(pasted);
                    } else {
                        Toast.makeText(this, "Invalid key in clipboard", Toast.LENGTH_SHORT).show();
                    }
                }
            } else {
                Toast.makeText(this, "Clipboard empty", Toast.LENGTH_SHORT).show();
            }
        });

        // Server status: maintenance mode + announcements
        findViewById(R.id.maintenanceRetry).setOnClickListener(v -> {
            findViewById(R.id.maintenanceOverlay).setVisibility(View.GONE);
            fetchServerStatus();
        });
        fetchServerStatus();
    }

    /**
     * Fetches /api/status on a background thread and applies it to the UI:
     * - maintenance ON  -> show the full-screen maintenance overlay
     * - announcements    -> show the latest two on the login card
     * Server unreachable or invalid JSON leaves the normal login untouched.
     */
    private void fetchServerStatus() {
        new Thread(() -> {
            try {
                String raw = GetServerStatus();
                if (raw == null || raw.trim().isEmpty()) return;
                JSONObject status = new JSONObject(raw);
                final boolean maintenance = status.optBoolean("maintenance", false);
                final String message = status.optString("maintenanceMessage", "We'll be back soon.");
                final JSONArray announcements = status.optJSONArray("announcements");
                final JSONObject updates = status.optJSONObject("updates");
                runOnUiThread(() -> {
                    if (!updatePromptShown) {
                        updatePromptShown = true;
                        maybeShowAppUpdate(updates);
                    }
                    if (maintenance) {
                        ((TextView) findViewById(R.id.maintenanceMessage)).setText(message);
                        findViewById(R.id.maintenanceOverlay).setVisibility(View.VISIBLE);
                    } else {
                        findViewById(R.id.maintenanceOverlay).setVisibility(View.GONE);
                        renderAnnouncements(announcements);
                    }
                });
            } catch (Exception ignored) {
                // Server offline or malformed response -> leave normal login UI.
            }
        }).start();
    }

    /* ---------------- App (APK) update handling ---------------- */

    private void maybeShowAppUpdate(JSONObject updates) {
        if (updates == null) return;
        JSONObject app = updates.optJSONObject("app");
        if (app == null) return;

        String version = app.optString("version", "");
        String url = app.optString("url", "");
        boolean enabled = app.optBoolean("enabled", false);
        boolean forced = app.optBoolean("forced", true);
        String changelog = app.optString("changelog", "");

        if (!enabled || url.length() == 0 || version.length() == 0 || version.equals(APP_VERSION)) return;

        String message = "Version " + version + " is now available. You are on " + APP_VERSION + "."
                + (changelog.length() > 0 ? "\n\n" + changelog : "");

        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage(message)
                .setPositiveButton("Update now", (d, w) -> startAppUpdate(url));
        if (!forced) {
            builder.setNegativeButton("Later", null);
        }

        AlertDialog dialog = builder.create();
        dialog.setCancelable(!forced);
        dialog.setOnCancelListener(l -> {
            if (forced) {
                try {
                    if (isFinishing() || isDestroyed()) return;
                    dialog.show();
                } catch (Exception ignored) {}
            }
        });
        try {
            dialog.show();
        } catch (Exception ignored) {}
    }

    private File getApkDest() {
        File base = getExternalFilesDir("updates");
        if (base == null) base = getFilesDir();
        return new File(base, "viper-update.apk");
    }

    private void startAppUpdate(String url) {
        pendingApkUrl = url;
        showUpdateProgress("Preparing download…");
        AppUpdater.download(url, getApkDest(),
                percent -> {
                    if (updateDialog != null && updateDialog.isShowing()) {
                        updateProgress.setIndeterminate(false);
                        updateProgress.setMax(100);
                        updateProgress.setProgress(percent);
                        updateProgressText.setText("Downloading update " + percent + "%");
                    }
                },
                (ok, msg) -> runOnUiThread(() -> {
                    dismissUpdateProgress();
                    if (ok) {
                        requestInstallPermission(getApkDest());
                    } else {
                        showUpdateError(msg != null ? msg : "Download failed");
                    }
                }));
    }

    private void requestInstallPermission(File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            pendingApkFile = apk;
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                startActivityForResult(intent, REQUEST_INSTALL_UPDATE_PERMISSION);
            } catch (Exception e) {
                showUpdateError("Could not open install permission settings: " + e.getMessage());
            }
            return;
        }
        installApk(apk);
    }

    private void installApk(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            showUpdateError("Install failed: " + e.getMessage());
        }
    }

    private void showUpdateProgress(String label) {
        if (updateDialog == null) {
            updateDialog = new Dialog(this);
            updateDialog.setContentView(R.layout.ios_loading);
            updateDialog.setCancelable(false);
            if (updateDialog.getWindow() != null) {
                updateDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            }
        }
        TextView loadingText = updateDialog.findViewById(R.id.loadingText);
        updateProgress = updateDialog.findViewById(R.id.progressBar);
        updateProgressText = updateDialog.findViewById(R.id.progressText);
        Button okButton = updateDialog.findViewById(R.id.okButton);
        if (loadingText != null) loadingText.setText(label);
        if (updateProgress != null) {
            updateProgress.setIndeterminate(true);
            updateProgress.setProgress(0);
            updateProgress.setVisibility(View.VISIBLE);
        }
        if (updateProgressText != null) updateProgressText.setText("Please wait…");
        if (okButton != null) okButton.setVisibility(View.GONE);
        try {
            if (!updateDialog.isShowing()) updateDialog.show();
        } catch (Exception ignored) {}
    }

    private void dismissUpdateProgress() {
        if (updateDialog != null && updateDialog.isShowing()) {
            try { updateDialog.dismiss(); } catch (Exception ignored) {}
        }
    }

    private void showUpdateError(String message) {
        try {
            AlertDialog.Builder builder = new AlertDialog.Builder(this)
                    .setTitle("Update failed")
                    .setMessage((message != null ? message : "Unknown error") + "\n\nCheck your connection and try again.")
                    .setNegativeButton("Close", null);
            if (pendingApkUrl != null) {
                builder.setPositiveButton("Retry", (d, w) -> startAppUpdate(pendingApkUrl));
                builder.setOnCancelListener(l -> {
                    if (pendingApkUrl != null) startAppUpdate(pendingApkUrl);
                });
            }
            AlertDialog dialog = builder.create();
            dialog.setCancelable(pendingApkUrl == null);
            dialog.show();
            if (pendingApkUrl != null) dialog.setCanceledOnTouchOutside(false);
        } catch (Exception ignored) {}
    }

    private void renderAnnouncements(JSONArray announcements) {
        LinearLayout card = findViewById(R.id.announcementCard);
        if (card == null) return;
        if (announcements == null || announcements.length() == 0) {
            card.setVisibility(View.GONE);
            return;
        }

        TextView title1 = findViewById(R.id.announcementTitle1);
        TextView body1 = findViewById(R.id.announcementBody1);
        TextView title2 = findViewById(R.id.announcementTitle2);
        TextView body2 = findViewById(R.id.announcementBody2);

        try {
            JSONObject first = announcements.getJSONObject(0);
            title1.setText(first.optString("title", ""));
            body1.setText(first.optString("body", ""));

            if (announcements.length() > 1) {
                JSONObject second = announcements.getJSONObject(1);
                title2.setText(second.optString("title", ""));
                body2.setText(second.optString("body", ""));
                title2.setVisibility(View.VISIBLE);
                body2.setVisibility(View.VISIBLE);
            } else {
                title2.setVisibility(View.GONE);
                body2.setVisibility(View.GONE);
            }

            boolean hasContent = title1.getText().length() > 0 || body1.getText().length() > 0;
            card.setVisibility(hasContent ? View.VISIBLE : View.GONE);
        } catch (Exception ignored) {
            card.setVisibility(View.GONE);
        }
    }
   


    // Permissions handling
    private void checkAndRequestPermissions() {
        android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean permissionsGranted = prefs.getBoolean(PREF_PERMISSIONS_GRANTED, false);

        if (!isStoragePermissionGranted()) {
            requestStoragePermissionDirect();
        } else if (!canRequestPackageInstalls()) {
            requestUnknownAppPermissionsDirect();
        } else {
            prefs.edit().putBoolean(PREF_PERMISSIONS_GRANTED, true).apply();
        }
    }

    private boolean isStoragePermissionGranted() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager();
    }

    private void requestStoragePermissionDirect() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.fromParts("package", getPackageName(), null));
            startActivityForResult(intent, REQUEST_MANAGE_STORAGE_PERMISSION);
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_MANAGE_STORAGE_PERMISSION);
        }
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
    }

    private void requestUnknownAppPermissionsDirect() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, REQUEST_MANAGE_UNKNOWN_APP_SOURCES);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_MANAGE_STORAGE_PERMISSION) {
            // Re-check permissions no matter what
            checkAndRequestPermissions();
        } else if (requestCode == REQUEST_MANAGE_UNKNOWN_APP_SOURCES) {
            if (canRequestPackageInstalls()) {
                // Re-initialize the activity with the freshly granted permission
                // instead of killing the process (which looked like a crash).
                recreate();
            }
        } else if (requestCode == REQUEST_INSTALL_UPDATE_PERMISSION) {
            boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
            if (allowed && pendingApkFile != null) {
                installApk(pendingApkFile);
            } else {
                showUpdateError("Install from unknown sources is required to continue the update.");
            }
        }
    }

    

    private boolean iskokofm() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network activeNetwork = cm.getActiveNetwork();
                if (activeNetwork != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(activeNetwork);
                    if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                        return true;
                    }
                }
            } else {
                // Fallback for older devices: check network interface names for common VPN interfaces
                try {
                    java.util.Enumeration<java.net.NetworkInterface> interfaces = java.net.NetworkInterface.getNetworkInterfaces();
                    while (interfaces != null && interfaces.hasMoreElements()) {
                        java.net.NetworkInterface intf = interfaces.nextElement();
                        String name = intf.getName();
                        if (name != null) {
                            if (name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("tap")) {
                                return true;
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return false;
    }

    // Login
    private void Login(final Context m_Context, final String userKey) {
        showLoadingDialog("Checking key...", false);

        Handler loginHandler = new Handler(msg -> {
            dismissLoadingDialog();
            if (msg.what == 0) {
                startDownload(m_Context);
            } else if (msg.what == 1) {
                showLoadingDialog((String) msg.obj, true);
            }
            return true;
        });

        new Thread(() -> {
            String result = Check(m_Context, userKey, APP_VERSION); // native
            if ("OK".equals(result)) {
                loginHandler.sendEmptyMessage(0);
                
            } else {
                Message msg = Message.obtain();
                msg.what = 1;
                msg.obj = result;
                loginHandler.sendMessage(msg);
            }
        }).start();
    }

    private void startDownload(Context m_Context) {
        showLoadingDialog("Downloading files...", false);

        Downtwo task = new Downtwo(LogAct.this, success -> {
            dismissLoadingDialog();
            if (success) {
                Intent i = new Intent(m_Context.getApplicationContext(), MAct.class);
                m_Context.startActivity(i);
            } else {
                Toast.makeText(LogAct.this, "Download failed!", Toast.LENGTH_SHORT).show();
            }
        });

        task.setProgressListener(progress -> runOnUiThread(() -> {
            if (loadingDialog != null && loadingDialog.isShowing()) {
                ProgressBar progressBar = loadingDialog.findViewById(R.id.progressBar);
                TextView progressText = loadingDialog.findViewById(R.id.progressText);

                progressBar.setIndeterminate(false);
                progressBar.setMax(100);
                progressBar.setProgress(progress);

                progressText.setText("Downloading... " + progress + "%");
            }
        }));

        task.execute(Downtwo.Link());
    }

    /**
     * Keep an AlertDialog-style helper (legacy) for places that might use it.
     * Uses ios_loading to avoid missing layout resource errors.
     */
    private AlertDialog showLoadingDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        // Use ios_loading (existing layout) to avoid compilation error when dialog_loading is absent
        builder.setView(R.layout.ios_loading);
        AlertDialog dialog = builder.create();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }
        dialog.setCancelable(false);
        dialog.show();
        return dialog;
    }

    // Dialog (main)
    private void showLoadingDialog(String message, boolean isError) {
        if (loadingDialog == null) {
            loadingDialog = new Dialog(this);
            loadingDialog.setContentView(R.layout.ios_loading);
            loadingDialog.setCancelable(false);
            if (loadingDialog.getWindow() != null) {
                loadingDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            }
        }

        TextView loadingText = loadingDialog.findViewById(R.id.loadingText);
        ProgressBar progressBar = loadingDialog.findViewById(R.id.progressBar);
        Button okButton = loadingDialog.findViewById(R.id.okButton);

        if (isError) {
            progressBar.setVisibility(View.GONE);
            okButton.setVisibility(View.VISIBLE);
            loadingText.setText("Login failed: " + message);
            okButton.setOnClickListener(v -> dismissLoadingDialog());
        } else {
            progressBar.setVisibility(View.VISIBLE);
            okButton.setVisibility(View.GONE);
            loadingText.setText(message != null ? message : "Loading...");
        }

        loadingDialog.show();
    }

    private void dismissLoadingDialog() {
        if (loadingDialog != null && loadingDialog.isShowing()) {
            loadingDialog.dismiss();
        }
    }

    // --- Natives
    private static native String Check(Context mContext, String userKey, String appVersion);
    private native String GetKey();
    private native String GetServerStatus();


}