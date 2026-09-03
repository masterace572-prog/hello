package com.ryzen.utils;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.util.Log;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import net.lingala.zip4j.ZipFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

public class Downtwo extends AsyncTask<String, String, String> {
    private static final String TAG = "Downtwo";

    public static native String Version();
    public static native String Link();

    public interface Callback {
        void onComplete(boolean success);
    }

    // 🔹 NEW: Progress listener for % updates
    public interface ProgressListener {
        void onProgress(int percent);
    }

    private final Context context;
    private final Callback callback; // may be null
    private ProgressListener progressListener; // 🔹 Added
    private androidx.appcompat.app.AlertDialog progressDialog;
    private String serverVersion = "0.0";
    private static final String PREF_NAME = "com.ryzen.download";
    private static final String PREF_VERSION_KEY = "version";
    private static final String HOSTOP_ZIP = "DIE.zip";
    private static final String LOADER_DIR_NAME = "loader";

    // Backwards-compatible constructor (no callback)
    public Downtwo(Context context) {
        this(context, null);
    }

    // New constructor with callback
    public Downtwo(Context context, Callback callback) {
        this.context = context;
        this.callback = callback;
    }

    // 🔹 Setter for progress listener
    public void setProgressListener(ProgressListener listener) {
        this.progressListener = listener;
    }

    @Override
    protected void onPreExecute() {
        super.onPreExecute();

        // NOTE: We no longer show a built-in dialog, LogAct will show its own custom one
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            if (activity.isFinishing() || activity.isDestroyed()) {
                return;
            }
        }
    }

    @Override
    protected String doInBackground(String... params) {
        try {
            if (params.length == 0 || params[0] == null) {
                return "Invalid URL provided";
            }

            String downloadUrl = params[0];
            serverVersion = getServerVersion();

            if (serverVersion == null) {
                return "Failed to retrieve server version";
            }

            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            String localVersion = prefs.getString(PREF_VERSION_KEY, "0.0");

            if (!localVersion.equals(serverVersion)) {
                publishProgress("Downloading update...");
                return downloadAndExtract(downloadUrl);
            } else {
                return "No Update Available";
            }
        } catch (Exception e) {
            Log.e(TAG, "doInBackground error: ", e);
            return "Background error: " + e.getMessage();
        }
    }

    @Override
    protected void onProgressUpdate(String... values) {
        super.onProgressUpdate(values);
        // This was for internal dialog → now handled in LogAct, so keep silent
    }

    @Override
    protected void onPostExecute(String result) {
        super.onPostExecute(result);

        // Determine success: null == download applied; "No Update Available" treated as success too
        boolean success = (result == null) || "No Update Available".equals(result);

        // invoke callback if provided
        try {
            if (callback != null) {
                callback.onComplete(success);
            }
        } catch (Exception e) {
            Log.e(TAG, "Callback threw exception: ", e);
        }

        // Show final message only if activity is alive
        if (!success) {
            showFinalMessage("Error: " + result);
        }
    }

    private String getServerVersion() {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(Version());
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestMethod("GET");

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                Log.e(TAG, "Version request failed with HTTP " + responseCode);
                return null;
            }

            try (InputStream inputStream = connection.getInputStream();
                 Scanner scanner = new Scanner(inputStream, "UTF-8")) {
                if (!scanner.hasNextLine()) return null;
                String version = scanner.nextLine().trim();
                return version.isEmpty() ? null : version;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error fetching server version: ", e);
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String downloadAndExtract(String urlString) {
        HttpURLConnection connection = null;
        File pathOutput = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                return "Download failed: HTTP " + responseCode;
            }

            int totalSize = connection.getContentLength();
            int downloaded = 0;
            File pathBase = context.getFilesDir();
            if (!pathBase.exists() && !pathBase.mkdirs()) {
                return "Download failed: unable to create app storage";
            }

            pathOutput = new File(pathBase, HOSTOP_ZIP);
            if (pathOutput.exists() && !pathOutput.delete()) {
                return "Download failed: unable to replace old archive";
            }

            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(pathOutput)) {
                byte[] data = new byte[8192];
                int count;
                while ((count = input.read(data)) != -1) {
                    output.write(data, 0, count);
                    downloaded += count;
                    if (totalSize > 0 && progressListener != null) {
                        int percent = Math.min(99, (int) ((downloaded * 100L) / totalSize));
                        progressListener.onProgress(percent);
                    }
                }
                output.flush();
            }

            if (!pathOutput.exists() || pathOutput.length() == 0) {
                return "Download failed: empty archive";
            }

            File loaderDirectory = new File(pathBase, LOADER_DIR_NAME);
            if (!loaderDirectory.exists() && !loaderDirectory.mkdirs()) {
                return "Download failed: unable to create loader directory";
            }

            // The current dark.zip is not encrypted; support password-protected
            // archives as well without forcing a password on unencrypted files.
            ZipFile zipFile = new ZipFile(pathOutput);
            if (zipFile.isEncrypted()) {
                zipFile.setPassword("0000".toCharArray());
            }
            zipFile.extractAll(loaderDirectory.getAbsolutePath());

            File extractedLibrary = new File(loaderDirectory, "libbgmi.so");
            if (!extractedLibrary.isFile() || extractedLibrary.length() == 0) {
                return "Download failed: libbgmi.so missing from archive";
            }

            setPermissions(loaderDirectory);
            if (progressListener != null) progressListener.onProgress(100);
            if (!pathOutput.delete()) {
                Log.w(TAG, "Downloaded archive could not be deleted: " + pathOutput.getAbsolutePath());
            }

            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(PREF_VERSION_KEY, serverVersion).apply();
            return null;
        } catch (Exception e) {
            Log.e(TAG, "Error downloading or extracting file: ", e);
            return "Download failed: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        } finally {
            if (connection != null) connection.disconnect();
            if (pathOutput != null && pathOutput.exists()) pathOutput.delete();
        }
    }

    private void setPermissions(File directory) {
        if (directory == null) return;
        if (directory.isDirectory()) {
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    setPermissions(file);
                }
            }
        } else {
            directory.setReadable(true, false);
            directory.setWritable(true, false);
            directory.setExecutable(true, false);
        }
    }

    private void showFinalMessage(String message) {
        // Only show if activity/context alive
        if (context instanceof Activity) {
            Activity activity = (Activity) context;
            if (activity.isFinishing() || activity.isDestroyed()) {
                return;
            }
        }

        try {
            new MaterialAlertDialogBuilder(context)
                    .setTitle("Update Status")
                    .setMessage(message)
                    .setPositiveButton("OK", (dialog, which) -> {
                        try {
                            dialog.dismiss();
                        } catch (Exception ignored) {}
                    })
                    .show();
        } catch (Exception e) {
            Log.e(TAG, "Failed to show final message dialog: ", e);
        }
    }
}
