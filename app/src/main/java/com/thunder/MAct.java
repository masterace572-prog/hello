package com.ryzen;

import android.annotation.SuppressLint;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AlertDialog;
import android.content.pm.PackageManager;
import com.ryzen.utils.AppManager;

import org.lsposed.lsparanoid.Obfuscate;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.zip.CRC32;
import top.niunaijun.blackbox.core.env.BEnvironment;
import top.niunaijun.blackbox.BlackBoxCore;
import top.niunaijun.blackbox.entity.pm.InstallResult;



@Obfuscate
public class MAct extends AppCompatActivity {

    static {
        try {
            System.loadLibrary("ryzen");
        } catch (UnsatisfiedLinkError ignored) {}
    }
    public static native String apkcrc(); // returns the expected CRC32 as string
    private static final String PKG_BGMI = "com.pubg.imobile";
    private static final int USER_ID = 0;

    private ProgressBar progressBar;
    private TextView progressText;
    private Button copyObbButton;
    private Button startButton;
    private boolean isObbCopied = false;
    private boolean isCopyingObb = false;
    private boolean isLaunching = false;
    private AppManager appManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable expiryRunnable;

    private static final String OBB_SOURCE_PATH =
            "/storage/emulated/0/Android/obb/com.pubg.imobile/main.21325.com.pubg.imobile.obb";
    // BlackBox owns the virtualized external OBB directory. Hardcoding a public
    // SdCard path makes launch fail on Android 11+ and on devices with different
    // storage layouts.
    private File getObbDestinationDir() {
        return BEnvironment.getExternalObbDir(PKG_BGMI);
    }
    public static native String exdate();
    // Declare the native method in Java
    


    @SuppressLint("NewApi")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
       

        setContentView(R.layout.activity_main);

        getWindow().setStatusBarColor(getColor(R.color.background));
        appManager = new AppManager(this);
        doCountTimerAccout();

        progressBar = findViewById(R.id.progressBar);
        progressText = findViewById(R.id.progressText);

        // BGMI START
        startButton = findViewById(R.id.startBgmi);
        startButton.setText("Launch");
        // One tap: install into the virtual container if needed, prepare OBB,
        // then launch the game. No intermediate options dialog is required.
        startButton.setOnClickListener(v -> handleLaunchFlow());

        copyObbButton = findViewById(R.id.copyObb);
        copyObbButton.setOnClickListener(v -> copyObbFiles(false));
        updateObbButtonVisibility();
    }

    private void showStartOptions() {
        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setView(R.layout.dialog_start_options)
                .create();

        dialog.setOnShowListener(ignored -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            }

            Button launchButton = dialog.findViewById(R.id.optionLaunch);
            Button copyButton = dialog.findViewById(R.id.optionCopyObb);
            Button clearButton = dialog.findViewById(R.id.optionClearLogin);
            android.view.View closeButton = dialog.findViewById(R.id.optionClose);

            if (launchButton != null) {
                launchButton.setOnClickListener(v -> {
                    dialog.dismiss();
                    handleLaunchFlow();
                });
            }
            if (copyButton != null) {
                copyButton.setVisibility(hasDestinationObb() ? android.view.View.GONE : android.view.View.VISIBLE);
                copyButton.setOnClickListener(v -> {
                    dialog.dismiss();
                    copyObbFiles(true);
                });
            }
            if (clearButton != null) {
                clearButton.setOnClickListener(v -> {
                    dialog.dismiss();
                    handleClearLogin();
                });
            }
            if (closeButton != null) {
                closeButton.setOnClickListener(v -> dialog.dismiss());
            }
        });
        dialog.show();
    }

    private void handleLaunchFlow() {
        if (isCopyingObb || isLaunching) return;
        if (startButton != null) {
            startButton.setEnabled(false);
            startButton.setText("Starting...");
        }
        try {
            if (!BlackBoxCore.get().isInstalled(PKG_BGMI, USER_ID)) {
                InstallResult result = BlackBoxCore.get().installPackageAsUser(PKG_BGMI, USER_ID);
                if (result != null && result.success) {
                    Toast.makeText(this, "BGMI installed. Preparing launch...", Toast.LENGTH_SHORT).show();
                    mainHandler.postDelayed(this::handleLaunchFlow, 1200);
                } else {
                    resetStartButton();
                    Toast.makeText(this, "Install failed: " + (result == null ? "unknown error" : result.msg), Toast.LENGTH_LONG).show();
                }
                return;
            }
            if (hasDestinationObb()) {
                isObbCopied = true;
                launchGame();
            } else {
                copyObbFiles(true);
            }
        } catch (Throwable t) {
            resetStartButton();
            Log.e("MAct", "Launch preparation failed", t);
            Toast.makeText(this, "Launch preparation failed. Please try again.", Toast.LENGTH_LONG).show();
        }
    }

    private void resetStartButton() {
        if (startButton != null) {
            startButton.setEnabled(true);
            startButton.setText("Launch");
        }
    }

    private void handleClearLogin() {
        try {
            // Stop and clear package data for BGMI user 0
            BlackBoxCore.get().stopPackage(PKG_BGMI, USER_ID);
            BlackBoxCore.get().clearPackage(PKG_BGMI, USER_ID);
            Toast.makeText(this, "Login data cleared", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Failed to clear login: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
    // This method periodically checks the APK's CRC32 to detect any tampering
   
    private void doCountTimerAccout() {
        expiryRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    mainHandler.postDelayed(this, 1000);
                    SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
                    Date expiryDate = dateFormat.parse(exdate());
                    long now = System.currentTimeMillis();
                    long distance = expiryDate.getTime() - now;

                    long d = distance / (24 * 60 * 60 * 1000);
                    long h = (distance / (60 * 60 * 1000)) % 24;
                    long m = (distance / (60 * 1000)) % 60;
                    long s = (distance / 1000) % 60;

                    if (distance < 0) {
                        Toast.makeText(MAct.this, "License expired!", Toast.LENGTH_SHORT).show();
                    } else {
                        ((TextView) findViewById(R.id.tvD)).setText(String.format("%02d", d));
                        ((TextView) findViewById(R.id.tvH)).setText(String.format("%02d", h));
                        ((TextView) findViewById(R.id.tvM)).setText(String.format("%02d", m));
                        ((TextView) findViewById(R.id.tvS)).setText(String.format("%02d", s));
                    }
                } catch (Exception ignored) {}
            }
        };
        mainHandler.post(expiryRunnable);
    }

    private File getDestinationObbFile() {
        return new File(getObbDestinationDir(), new File(OBB_SOURCE_PATH).getName());
    }

    private boolean hasDestinationObb() {
        File destination = getDestinationObbFile();
        return destination.isFile() && destination.length() > 0;
    }

    private void updateObbButtonVisibility() {
        boolean exists = hasDestinationObb();
        isObbCopied = exists;
        if (copyObbButton != null) {
            copyObbButton.setVisibility(exists ? android.view.View.GONE : android.view.View.VISIBLE);
        }
    }

    private void copyObbFiles(boolean launchAfterCopy) {
        if (isCopyingObb) return;
        isCopyingObb = true;
        findViewById(R.id.progressCard).setVisibility(android.view.View.VISIBLE);
        progressText.setText("Copying OBB: 0%");
        progressBar.setProgress(0);
        if (copyObbButton != null) copyObbButton.setEnabled(false);

        new Thread(() -> {
            File destination = getDestinationObbFile();
            try {
                File source = new File(OBB_SOURCE_PATH);
                if (!source.isFile() || !source.canRead()) {
                    throw new IOException("Source OBB not found or not readable");
                }

                File destinationDir = getObbDestinationDir();
                if (destinationDir == null || (!destinationDir.exists() && !destinationDir.mkdirs())) {
                    throw new IOException("BlackBox OBB folder could not be created");
                }

                long total = source.length();
                if (total <= 0) throw new IOException("Source OBB is empty");
                long copied = 0;
                byte[] buffer = new byte[1024 * 64];

                File temporary = new File(destination.getParentFile(), destination.getName() + ".part");
                if (temporary.exists()) temporary.delete();
                try (FileInputStream input = new FileInputStream(source);
                     java.io.FileOutputStream output = new java.io.FileOutputStream(temporary)) {
                    int length;
                    while ((length = input.read(buffer)) != -1) {
                        output.write(buffer, 0, length);
                        copied += length;
                        final int progress = Math.min(99, (int) ((copied * 100L) / total));
                        runOnUiThread(() -> {
                            progressBar.setProgress(progress);
                            progressText.setText("Copying OBB: " + progress + "%");
                        });
                    }
                    output.flush();
                }

                if (!temporary.isFile() || temporary.length() != total || !temporary.renameTo(destination)) {
                    if (temporary.exists()) temporary.delete();
                    throw new IOException("Copied OBB verification failed");
                }

                runOnUiThread(() -> {
                    isObbCopied = true;
                    progressBar.setProgress(100);
                    progressText.setText("OBB copied successfully");
                    updateObbButtonVisibility();
                    isCopyingObb = false;
                    if (launchAfterCopy) launchGame();
                    else resetStartButton();
                });
            } catch (Exception e) {
                if (destination.exists()) destination.delete();
                runOnUiThread(() -> {
                    isCopyingObb = false;
                    resetStartButton();
                    if (copyObbButton != null) copyObbButton.setEnabled(true);
                    findViewById(R.id.progressCard).setVisibility(android.view.View.GONE);
                    Toast.makeText(this, "OBB copy failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    /** Launch BGMI */
    private void launchGame() {
        if (isLaunching) return;
        if (!hasDestinationObb()) {
            Toast.makeText(this, "Game data is missing. Copy OBB first.", Toast.LENGTH_LONG).show();
            return;
        }
        isLaunching = true;
        try {
            if (!BlackBoxCore.get().isInstalled(PKG_BGMI, USER_ID)) {
                isLaunching = false;
                resetStartButton();
                Toast.makeText(this, "Game is not installed in the virtual container.", Toast.LENGTH_LONG).show();
                return;
            }
            boolean launched = BlackBoxCore.get().launchApk(PKG_BGMI, USER_ID);
            if (!launched) {
                isLaunching = false;
                resetStartButton();
                Toast.makeText(this, "Game launch was rejected. Please retry.", Toast.LENGTH_LONG).show();
                return;
            }
            Toast.makeText(this, "Launching BGMI...", Toast.LENGTH_SHORT).show();
            mainHandler.postDelayed(() -> {
                isLaunching = false;
                resetStartButton();
            }, 2500);
        } catch (Throwable t) {
            isLaunching = false;
            resetStartButton();
            Log.e("MAct", "Game launch failed", t);
            Toast.makeText(this, "Launch failed safely. Please retry.", Toast.LENGTH_LONG).show();
        }
    }
    
    @Override
    protected void onDestroy() {
        if (expiryRunnable != null) mainHandler.removeCallbacks(expiryRunnable);
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}