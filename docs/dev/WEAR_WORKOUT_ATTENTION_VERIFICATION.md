# Workout attention — 2026-10-09

Physical installation update — 2026-10-10: user authorized installation. Both verified APKs installed successfully with `adb install -r` on phone SM-S918B and Galaxy Watch Ultra SM-L705F. Watch wireless address was rediscovered after its mDNS connection disappeared. App data was retained. Physical behavior checks remain pending; successful installation does not validate workout-start opening or sensor/vibration behavior.

User requested: keep the screen on during a set, automatically open the watch app when starting a phone workout, and a longer rest-finished vibration. Physical installation remains deferred.

## Behavior

- WearActivity sets `FLAG_KEEP_SCREEN_ON` only while foreground, workout active and confirmed capture phase is effort. Editors/options retain it during effort. Recovery/inactive state and onPause clear it. No wake lock, ambient implementation or global Always On setting changes.
- Live `beginWorkout` and repeat-today explicitly request opening. Restored sessions, history editing and backfill do not trigger it. The bridge retains a request during initialization and waits for the workout completion handler and unobstructed UI. It sends once per session and revalidates owner/session/readiness after publishing. Existing authenticated native remote-open validation, 30-second message validity and fallback notification remain. Delivery/opening still depends on connected devices and Wear OS policies; the manual button remains available.
- Rest alarm uses three 600 ms pulses separated by 200 ms gaps (2.2 seconds total), once. Existing alarm usage, app vibration preference and durable timer dedup remain intact. No automatic repeat loop.

## Evidence

- New bridge tests observed failing before implementation, then passed: initialization queue, readiness, once-per-session, subsequent workout, no restore/history opening and obsolete session rejection. Workout entry-point test confirms the request hook.
- New native screen-flag test failed on the original APK, then passed after implementation. Full round Wear OS API36 instrumentation suite passed: nine tests. Emulator notification permission was granted for the existing ongoing-notification test.
- Native JVM suites passed and both debug APKs compiled. Mobile build/Capacitor sync passed with byte-identical assets.
- Focused JS verification: 38 tests across five affected bridge/protocol/session/workout files passed; final bridge rerun passed all 15 tests. Full-suite attempts (default concurrency and two workers) both hit the existing `document-too-large retains its source across reopen while independent writes progress` 5-second timeout in Firestore storage tests; neither complete run is reported green. Remaining full-suite work was interrupted after that failure. The failing test passed alone in 4.26 seconds, with no timeout changes. Cloud storage implementation was not modified.
- No physical phone/watch installation performed. Actual opening at workout start, screen retention during lifting and perceived vibration strength need physical verification after installation.

APK SHA-256:

- Phone: `c8cb73a2869caf7234ac6b53a86f003c13d820c8af2a286ba5549bb73527e293`
- Watch: `080f102e57a69aeeb1746a71e64f75e14744715b7f9b550ad28b2146f7f73da8`
