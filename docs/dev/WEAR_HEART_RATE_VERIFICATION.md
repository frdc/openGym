# Heart rate per set and recovery

Implemented for the test phone companion and Galaxy Watch Ultra. User-selected behavior: explicitly start a set, complete it, then retain its recovery until the next explicit set start. Rest timer expiration, pause and extension do not close the measurement.

## Flow

1. Open a live workout on the phone and the companion on the watch.
2. On the watch, enable heart rate and grant the sensor permission in the system dialog. The optional Health Services exercise starts from the visible user action. If another app owns an exercise, OpenGym reports the conflict and keeps ordinary set logging available.
3. Start a supported repetition set on the watch. Phone confirmation creates the private binding and the set measurement marker durably.
4. Complete the set. Effort ends at the watch tap; recovery continues even when the timer reaches Ready.
5. Start the next set or finish the workout. The prior measurement closes. The phone shows effort/recovery means, peaks, sensor dots, and available real readings near 30/60/120 seconds with their actual measured time.

No missing samples are filled in. Interrupted or capped intervals remain partial. Heart rate does not affect training progression or completed-work duration.

## Persistence and transport

- Public nested `heartRate` stays on the completed row or side and follows existing history/cloud/export behavior.
- Owner/node/session bindings and bounded retry receipts remain in a private native journal, excluded from Android cloud backup and device transfer. Limits: 200 bindings, 512KiB per owner; oldest closed bindings are pruned.
- Watch raw readings/outbox are private and bounded. Wear packets contain a reduced plot of at most300 points plus summaries over valid measured samples. Selected end/milestone readings and phase extremes survive reduction.
- Packets are capability-authorized, v1, and at most16KiB. The phone acknowledges only after durable state and journal writes; the watch retires only the exact final packet acknowledgment.
- Late packets cannot extend a phone-confirmed next-start/workout-end boundary, shrink a newer final interval, change accounts, or attach to a deleted row. Cancelled repeated measurements restore the prior record.

## Verification status

- Native guard/model tests:17 passing in the final combined Android build. RED confirmed missing route/journal class and undersized receipt capacity.
- Domain targeted tests:33 passing after RED/GREEN boundary, duplicate, aggregate, completion-failure and interruption regressions.
- View/integration/locale focused tests:162 passing; all17 locale packs have2020 keys.
- Build script tests:6 passing. Web build and cloud artifact check passed.
- Whole suite:348 files/3820 tests passing. The final one-line disabled-effort aggregate correction was subsequently verified by33 focused tests. Final mobile build/sync and combined native APK build passed.
- Both final APKs installed with `-r --no-streaming`, retaining test training data. Same debug signing certificate verified. Phone APK SHA256 `1c30df14b7431e1bab1d8bc2dfa9ef1e9163ab3c42cfedc3580262c475d64758`; watch APK `9bc45754a55a77bf28d997645eb4767c5fe5edc9e42d3862cb1313dbd17b9db3`.
- On the physical Galaxy Watch Ultra:7 instrumentation tests passed (2 existing background/alarm,5 heart outbox tests). Only the instrumentation package was removed afterward. These isolated synthetic tests do not prove real sensor collection.
- Real sensor permission: user granted the watch system sensor permission. A repetition exercise (Air Bike) was added to the existing test workout, retaining its cardio entry.
- Real sensor transport/persistence: verified a completed test set with23 effort readings and4 recovery readings. Effort ended at22740ms; recovery ended at26331ms on the confirmed next start. Status complete; no30-second milestone was fabricated for that short recovery. The next set acquired its own readings and marker. Only filtered heart measurement data was read from the native local state; account/auth data was not printed.
- Longer recovery/screen-off continuity: user performed the screen-off test and then woke the watch without starting another set. A cumulative capture arrived with347 valid readings (56 effort,291 recovery), last sensor elapsed346922ms, effort end55468ms, and real milestones30/60/120. Its plot was reduced to300 points while all347 readings contributed to phase summaries. The phone timer displayed Ready while recovery remained open. This proves actual ambient collection and timestamp-preserving batch delivery; the live graph may update in a batch after the watch wakes.
- Watch ADB became unavailable after instrumentation, but ordinary paired companion transport remained functional. User was advised to disable collection on the watch to end the test; the active test workout was retained.

Official API guidance: [Health Services active exercise data](https://developer.android.com/health-and-fitness/health-services/active-data), [permissions](https://developer.android.com/health-and-fitness/health-services/permissions).

## Follow-up: starting a set ends the prior rest

User approved the change on09/10/2026. A newly durable-confirmed heart-start cancels only the previously validated rest token for the same owner/session. Running, paused and Ready timers are cleared. Failed starts leave rest untouched; replaying an old start or completing on the phone while start persistence awaits must retain the replacement completion rest. Ordinary completion continues the existing configured rest behavior.

RED reproduced the prior rest remaining active, then reproduced the concurrent-phone-completion race. Final focused verification:57 tests passing across bridge, heart host, protocol/session and UI timers. Independent focused review found no remaining issue. Mobile bundle rebuilt and Android assets verified byte-identical. Only the phone APK needs updating; watch source/protocol are unchanged.

Background behavior: the optional Health Services foreground service continues while heart collection is enabled and the cached workout context is active. Disabling collection, revoked permission, inactive workout or changed context stops the session. The service is START_NOT_STICKY and is not automatically started by background state callbacks. An Android cached process or an on-demand wearable message listener is separate from active sensor collection.

Follow-up phone APK: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`, SHA256 `1162bb43720216f73ab53211b98fce3c356481b3321fbf6a3de951a51364adfa`, :app:assembleDebug passed. Phone left ADB/mDNS before installation. User explicitly chose to install later; this timer correction is built but not installed on the device yet. No further deployment attempted after that choice.
