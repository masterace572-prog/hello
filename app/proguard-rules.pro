# Keep application package and JNI entry points
-keep class com.thunder.** { *; }
-keepclassmembers class com.thunder.** {
    public static native <methods>;
    native <methods>;
}

# Keep BlackBox Core interfaces
-keep class top.Vspace.blackbox.** { *; }
-dontwarn top.Vspace.blackbox.**

# Keep Zip4j and OkHttp network libraries
-dontwarn net.lingala.zip4j.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.codehaus.mojo.animal_sniffer.**

# Optimization flags for maximum APK size reduction
-optimizationpasses 5
-repackageclasses ''
-allowaccessmodification
-dontusemixedcaseclassnames
-dontpreverify
-verbose
