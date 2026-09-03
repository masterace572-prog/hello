package com.ryzen.utils;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.AsyncTask;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.ryzen.R;

import org.lsposed.lsparanoid.Obfuscate;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import top.niunaijun.blackbox.BlackBoxCore;
import top.niunaijun.blackbox.entity.pm.InstallResult;
import top.niunaijun.blackbox.core.env.BEnvironment;



@Obfuscate
public class AppManager extends AppCompatActivity {
    Context ctx;

    // Action codes
    public static final int INSTALL_APP = 1;
    public static final int COPY_OBB = 3;

    public interface CopyCallback {
        void onCopyCompleted(boolean success);
    }

    public AppManager(Context ctx) {
        this.ctx = ctx;
    }

    @SuppressLint("StaticFieldLeak")
    public void appManager(String pkg, int method) {
        new AsyncTask<Void, Integer, Boolean>() {
            String errorMessage = "";
            Dialog progressDialog;
            ProgressBar progressBar;
            TextView progressText;

            @Override
            protected void onPreExecute() {
                if (method == COPY_OBB) {
                    progressDialog = new Dialog(ctx);
                    progressDialog.setCancelable(false);

                    progressBar = progressDialog.findViewById(R.id.progressBar);
                    progressText = progressDialog.findViewById(R.id.progressText);

                    progressBar.setMax(100);
                    progressBar.setProgress(0);
                    progressText.setText("0/100");

                    progressDialog.show();
                }
            }

            @Override
            protected Boolean doInBackground(Void... voids) {
                if (method == COPY_OBB) {
                    return copyObbFolder(pkg);
                } else if (method == INSTALL_APP) {
                    return installApp(pkg);
                }
                return false;
            }

            @Override
            protected void onProgressUpdate(Integer... values) {
                if (method == COPY_OBB && progressBar != null && progressText != null) {
                    int progress = values[0];
                    progressBar.setProgress(progress);
                    progressText.setText(progress + "/100");
                }
            }

            @Override
            protected void onPostExecute(Boolean success) {
                if (progressDialog != null && progressDialog.isShowing()) {
                    progressDialog.dismiss();
                }
                showResultDialog(success, errorMessage);
            }

            private boolean copyObbFolder(String packageName) {
                File sourceDir = new File("/storage/emulated/0/Android/obb/", packageName);
                File destDir = BEnvironment.getExternalObbDir(packageName);

                if (!sourceDir.exists() || !sourceDir.isDirectory()) {
                    errorMessage = "OBB not found!";
                    return false;
                }

                if (!destDir.exists() && !destDir.mkdirs()) {
                    errorMessage = "Destination directory creation failed!";
                    return false;
                }

                File[] files = sourceDir.listFiles();
                if (files == null || files.length == 0) {
                    errorMessage = "No files found to copy!";
                    return false;
                }

                long totalBytes = 0, copiedBytes = 0;
                for (File file : files) {
                    totalBytes += file.length();
                }

                try {
                    byte[] buffer = new byte[8192];
                    for (File file : files) {
                        InputStream inputStream = new FileInputStream(file);
                        FileOutputStream outputStream = new FileOutputStream(new File(destDir, file.getName()));

                        int bytesRead;
                        while ((bytesRead = inputStream.read(buffer)) != -1) {
                            outputStream.write(buffer, 0, bytesRead);
                            copiedBytes += bytesRead;
                            publishProgress((int) ((copiedBytes * 100) / totalBytes));
                        }

                        inputStream.close();
                        outputStream.close();
                    }
                    return true;
                } catch (IOException e) {
                    errorMessage = "Error copying files: " + e.getMessage();
                    return false;
                }
            }

            private boolean installApp(String pkg) {
    try {
        // Get the package info to find the APK path
        PackageInfo packageInfo = ctx.getPackageManager().getPackageInfo(pkg, 0);
        String apkPath = packageInfo.applicationInfo.sourceDir;
        
        // Use BlackBoxCore to install the package
        InstallResult result = BlackBoxCore.get().installPackageAsUser(apkPath, 0); // Use default user ID 0
        
        if (!result.success) {
            errorMessage = "Installation failed: " + result.msg;
            return false;
        }
        return true;
    } catch (PackageManager.NameNotFoundException e) {
        errorMessage = "Package not found: " + e.getMessage();
        return false;
    } catch (Exception e) {
        errorMessage = "Installation error: " + e.getMessage();
        return false;
    }
}
            private void showResultDialog(boolean success, String errorMessage) {
                MaterialAlertDialogBuilder builder = new MaterialAlertDialogBuilder(ctx);
                builder.setTitle(success ? "Success" : "Error")
                      .setMessage(success ? 
                          (method == INSTALL_APP ? "App installed successfully." : "OBB copied successfully.") : 
                          errorMessage)
                      .setPositiveButton("OK", (dialog, which) -> dialog.dismiss())
                      .show();
            }
        }.execute();
    }

    public boolean checkObbContainer(String pkg) {
        File destDir = BEnvironment.getExternalObbDir(pkg);
        return destDir.exists() && destDir.isDirectory() && destDir.list().length > 0;
    }

    public void copyObbFolderAsync(final String packageName, final CopyCallback callback) {
        if (checkObbContainer(packageName)) {
            if (callback != null) {
                callback.onCopyCompleted(true);
            }
            return;
        }

        new AsyncTask<Void, Integer, Boolean>() {
            private String errorMessage = "";

            @Override
            protected Boolean doInBackground(Void... params) {
                return copyObbFolder(packageName);
            }

            @Override
            protected void onPostExecute(Boolean result) {
                if (callback != null) {
                    callback.onCopyCompleted(result);
                }
            }

            private boolean copyObbFolder(String packageName) {
                // Same implementation as above
                File sourceDir = new File("/storage/emulated/0/Android/obb/", packageName);
                File destDir = BEnvironment.getExternalObbDir(packageName);

                if (!sourceDir.exists() || !sourceDir.isDirectory()) {
                    errorMessage = "OBB not found!";
                    return false;
                }

                if (!destDir.exists() && !destDir.mkdirs()) {
                    errorMessage = "Destination directory creation failed!";
                    return false;
                }

                File[] files = sourceDir.listFiles();
                if (files == null || files.length == 0) {
                    errorMessage = "No files found to copy!";
                    return false;
                }

                long totalBytes = 0, copiedBytes = 0;
                for (File file : files) {
                    totalBytes += file.length();
                }

                try {
                    byte[] buffer = new byte[8192];
                    for (File file : files) {
                        InputStream inputStream = new FileInputStream(file);
                        FileOutputStream outputStream = new FileOutputStream(new File(destDir, file.getName()));

                        int bytesRead;
                        while ((bytesRead = inputStream.read(buffer)) != -1) {
                            outputStream.write(buffer, 0, bytesRead);
                            copiedBytes += bytesRead;
                            publishProgress((int) ((copiedBytes * 100) / totalBytes));
                        }

                        inputStream.close();
                        outputStream.close();
                    }
                    return true;
                } catch (IOException e) {
                    errorMessage = "Error copying files: " + e.getMessage();
                    return false;
                }
            }
        }.execute();
    }
}