Place your game package here as DIE.zip if you want to host it on Vercel
alongside this admin panel. The site will then serve it at:

  /files/DIE.zip   (static file, served by Vercel CDN)

After that, update the download URL in app/src/main/jni/main.cpp:

  Java_com_ryzen_utils_Downtwo_Link   ->  https://YOUR-PROJECT.vercel.app/files/DIE.zip
  Java_com_ryzen_utils_Downtwo_Version -> https://YOUR-PROJECT.vercel.app/files/version.txt

Keep version.txt in sync with the package. The client only downloads a
new package when the version string changes.
