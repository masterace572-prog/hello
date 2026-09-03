package com.ryzen;

import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads the new APK on a background thread and reports progress.
 * Install step is handled by LogAct (FileProvider + package installer).
 */
public class AppUpdater {

    public interface ProgressListener {
        void onProgress(int percent);
    }

    public interface CompleteListener {
        void onComplete(boolean success, String message);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public static void download(String url, File destination, ProgressListener progress, CompleteListener complete) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL urlObj = new URL(url);
                connection = (HttpURLConnection) urlObj.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("User-Agent", "Mozilla/5.0");

                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) {
                    postComplete(complete, false, "Server returned HTTP " + code);
                    return;
                }

                String type = connection.getContentType();
                if (type != null && type.toLowerCase().contains("text/plain")) {
                    postComplete(complete, false, "Unexpected response. Check the update URL.");
                    return;
                }

                long total = connection.getContentLengthLong();
                File parent = destination.getParentFile();
                if (parent != null && (parent.exists() || parent.mkdirs())) {
                    // ok
                }
                if (destination.exists()) destination.delete();

                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(destination)) {
                    byte[] buffer = new byte[8192];
                    int read;
                    long done = 0;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        done += read;
                        if (total > 0 && progress != null) {
                            final int percent = (int) Math.min(99, (done * 100L) / total);
                            MAIN.post(() -> progress.onProgress(percent));
                        }
                    }
                    out.flush();
                }

                if (!destination.isFile() || destination.length() == 0) {
                    postComplete(complete, false, "Downloaded file is empty.");
                    return;
                }
                postComplete(complete, true, null);
            } catch (Exception e) {
                postComplete(complete, false, e.getMessage() != null ? e.getMessage() : "Download failed");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private static void postComplete(CompleteListener listener, boolean ok, String message) {
        if (listener != null) {
            MAIN.post(() -> listener.onComplete(ok, message));
        }
    }
}
