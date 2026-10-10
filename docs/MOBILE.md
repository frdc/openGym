# Mobile build

Android uses Capacitor 7.6.9, Java 21, Gradle 8.11.1 and compile/target SDK 35. Node 22 builds the web assets. From `frontend`:

```sh
npm ci
npm run build:mobile
npm run check:cloud-bundle
```

The cross-platform Node runner sets `VITE_MOBILE=1`, preserves the pinned jsDelivr catalogue image/video URLs, builds/stamps the service worker, runs `cap sync android` and verifies every output byte against the Android public asset copy. All emitted JS/CSS lazy packs must be in the service-worker list. This command does not compile an APK.

Set `JAVA_HOME` to a JDK 21 installation and `ANDROID_HOME` to an SDK containing platform 35 in the current shell only. Then run from `frontend/android`:

```sh
./gradlew --no-daemon assembleDebug
```

Windows uses `./gradlew.bat --no-daemon assembleDebug`. The output is `app/build/outputs/apk/debug/app-debug.apk`. Debug keeps applicationId `ch.duartesantos.opengym.test` and x86_64 support; release retains ARM filters. FileProvider and cache paths remain for Share. The updater-only Install plugin and install-packages permission are removed. Do not distribute a debug APK as a signed release.

Local native two-slot archives are owner-separated and readback-verified. WebView eviction does not make localStorage the authority. Failed disk writes remain errors; only confirmed durable bytes can survive immediate process loss. Own photos/videos remain local. Local reminders/rest alarms and opaque session/timer guards are retained.

Firebase public configuration is compiled at build time as documented in README.md. Ordinary local builds need no production config. No production setup, accounts, rules, billing or migration is performed by these commands. Actual demo-project Auth/Firestore QA and physical device/offline checks are separate. Release mixed-content settings remain strict; no shared debug transport relaxation is introduced.

## iOS policy

The iOS source shell is retained with the obsolete vault pod removed. `build:mobile` intentionally syncs Android only, so Windows does not imply fresh iOS assets or CocoaPods success. To validate iOS on macOS, build mobile assets with the runner, explicitly run `npx cap sync ios`, then `node scripts/check-mobile-bundle.mjs --ios`, followed by a separate Xcode build/device check. Never ship an existing iOS public directory without that fresh sync. No iOS QA is claimed here.

## Wear OS básico

O módulo `wear` gera um APK acompanhante para Galaxy Watch Ultra/Wear OS. Ele mostra exercício/série e controla conclusão e descanso; o app Android continua responsável por salvar o treino. Compilar com `gradlew.bat --no-daemon :app:assembleDebug :wear:assembleDebug`. Os dois APKs debug usam `ch.duartesantos.opengym.test` e devem ser assinados pelo mesmo certificado. Ver [instalação, limitações e checklist físico](dev/WEAR_OS_VERIFICATION.md). Batimentos não fazem parte desta primeira versão.

## Updates

The upstream APK updater/download action is retired until an adapted signed release channel is reviewed. PWA service-worker updates remain. Inherited publishing, release/upload and mirror workflows are removed; compilation does not publish anything.

## Verified local delivery

See [Offline / Firestore verification](dev/OFFLINE_FIRESTORE_VERIFICATION.md) for exact product/artifact hashes, commands, actual device evidence and limits. An ordinary unconfigured APK stores training locally; cloud login requires a separately configured build. A demo-emulator APK is a distinct verification artifact requiring the named local servers and dedicated ADB reverse mappings. Preserve the ordinary APK before packaging demo assets and restore ordinary assets/configuration for the final local delivery. The seeded `VITE_DEMO` build flag is unrelated to Firebase emulator mode.

Android process termination before a local save confirmation may lose that unconfirmed edit. Confirmed revisions are read back from the owner-specific two-slot archive; corruption of the newest slot falls back to the other valid slot. Clearing all app data or uninstalling can remove those files and local media. WebView-only data loss and full app-data deletion are different operations and must be described separately in verification evidence.

Guest backup import/export works locally while offline. Signed-in backup restore requires a connection for the server-verified merge/replace preview; reconnect before importing. A connectivity failure leaves the backup unapplied and asks you to connect. Workouts and confirmed local training remain available offline.
