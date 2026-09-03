package com.ryzen;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.util.Log;
import top.niunaijun.blackbox.BlackBoxCore;
import top.niunaijun.blackbox.app.configuration.AppLifecycleCallback;
import top.niunaijun.blackbox.app.configuration.ClientConfiguration;
import java.io.File;
import com.ryzen.utils.Prefs;
// import top.niunaijun.blackbox.core.system.api.MetaActivationManager; // Comment karo

public class BoxApplication extends Application {

static {
        try {
            System.loadLibrary("ryzen");
        } catch (UnsatisfiedLinkError error) {
            Log.e("BoxApplication", "ryzen native library is unavailable", error);
        }
    }
    // public static native String getSdkKey(); // Comment karo
    private static final String TAG = "BoxApplication";
    private final String[] process_names = {
            "com.pubg.krmobile",   // KOREA - 1
            "com.tencent.ig",      // GLOBAL - 2
            "com.rekoo.pubgm",     // TAIWAN - 3
            "com.vng.pubgmobile",  // VIETNAM - 4
            "com.pubg.imobile"     // BGMI - 5
    };

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        Log.d(TAG, "BoxApplication attachBaseContext started");
        Prefs prefs = new Prefs(base);
        try {
            Log.d(TAG, "Initializing BlackBoxCore...");
            BlackBoxCore.get().doAttachBaseContext(base, new ClientConfiguration() {
                @Override
                public String getHostPackageName() {
                    return base.getPackageName();
                }

                @Override
                public boolean isEnableDaemonService() {
                    return false;
                }

               @Override
                public boolean requestInstallPackage(File file){
                    PackageInfo packageInfo = base.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),0);
                    return false;
                }
            });
            // Hide-root and hide-Xposed APIs are not present in the bundled BlackBoxCore version.
            Log.d(TAG, "BlackBoxCore initialization completed");
            Log.d(TAG, "App name check completed");
        } catch (Exception e) {
            Log.e(TAG, "Error in attachBaseContext", e);
            e.printStackTrace();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            BlackBoxCore.get().doCreate();
            // Optional SDK activation is not available in the bundled BlackBoxCore dependency.
        } catch (Throwable error) {
            Log.e(TAG, "BlackBox SDK startup failed", error);
            return;
        }
        BlackBoxCore.get().addAppLifecycleCallback(new AppLifecycleCallback() {
            @Override
            public void beforeCreateApplication(String packageName, String processName, Context context, int userId) {
                // Handle before application creation
            }

            @Override
                public void beforeApplicationOnCreate(String packageName, String processName, Application application, int userId) {
                    try {
                        for (String pkg : process_names) {
                            if (pkg.equals(packageName) && pkg.equals(processName)) {

                                // BGMI loader
                                if (pkg.equals("com.pubg.imobile")) {
                                    File p1 = new File(getFilesDir(), "loader/libbgmi.so");
                                    if (p1.exists()) {
                                        System.load(p1.getAbsolutePath());
                                        Log.d("App", "Loaded libbgmi.so for BGMI");
                                    } else {
                                        Log.e("App", "libbgmi.so not found!");
                                    }
                                }

                                // PUBG Global loader
                                if (pkg.equals("com.tencent.ig")) {
                                    File p2 = new File(getFilesDir(), "loader/libpubgm.so");
                                    if (p2.exists()) {
                                        System.load(p2.getAbsolutePath());
                                        Log.d("App", "Loaded libpubgm.so for PUBG Global");
                                    } else {
                                        Log.e("App", "libpubgm.so not found!");
                                    }
                                }

                                break;
                            }
                        }
                    } catch (UnsatisfiedLinkError e) {
                        Log.e("App", "Native game library load failed", e);
                    } catch (Exception e) {
                        Log.e("App", "Error loading game libraries", e);
                    }
                }

            @Override
            public void afterApplicationOnCreate(String packageName, String processName, Application application, int userId) {
                // Handle after application onCreate
            }
        });
    }
}