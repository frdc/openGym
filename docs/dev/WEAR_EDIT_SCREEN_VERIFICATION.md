# Watch editing screen — 2026-10-09

Implemented the approved compact round screen: exercise/series, effort or rest timer, tappable repetitions/load, primary action and separate options. Draft editors use minus/plus, confirmation and cancellation. Weight steps and units follow the phone exercise configuration. Phone validates context, revision, target and unit, then persists through the existing set-field rules, including manual weight inheritance and unilateral sides. Side normalization preserves completion timestamp and heart metadata.

Unrelated sync retains a draft; changed target/context/unit/edited baseline invalidates it. Blank fields can start at zero. Pending commands cannot be resent or adjusted. Editing does not restart timers or heart capture. Existing confirmed-start cancellation of prior rest remains.

The native monochrome heart pulses when the foreground screen receives valid recent readings (up to 15 seconds old). It becomes gray/static when stale or stopped. Animation indicates recent collection, not individual physiological beats. Background capture lifecycle and notification controls remain in place.

## Verification

- Full frontend suite: 350 files, 3,836 tests passed. The initial parallel run had one unrelated Firestore test exceed the default timeout; its 38-test file and the complete rerun passed without timeout changes.
- Native JVM: 22 tests passed across phone and watch suites.
- Wear OS API36 round emulator, 454×454: all eight instrumentation tests passed, including draft cancellation, unrelated synchronization, changed baseline and blank load. The notification test required the emulator notification permission; it then passed.
- Actual emulator screenshots inspected: `.superpowers/wear-edit-main.png`, `wear-edit-load.png`, `wear-edit-reps.png`. Main and editor actions fit the circular viewport with 48 dp touch targets. Synthetic state was used; this does not establish physical phone/watch synchronization or sensor readings for this release.
- Independent source review: initial test-tag and blank-field findings fixed; re-review found no actionable defects.
- Mobile production build and Capacitor synchronization passed with byte-identical assets. Both debug APKs compiled.

Physical installation is deferred at the user's request. Current APK SHA-256:

- Phone `frontend/android/app/build/outputs/apk/debug/app-debug.apk`: `19e09df94b266b003116375be2d2c37a07e17619cbc56f9ece57133cd71218cc`
- Watch `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`: `c5069d38cf6c3bc3979e85a75d9c2ee9e1d7b8c5123698baf03ed8a80ea63745`

Next physical verification after installation: edit reps/load on the watch, confirm the matching phone set changes, and verify the fresh heart pulse during effort and rest. No physical devices were updated in this task.
