# Wear Standalone Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Independent phone and watch reducers may be delegated with dispatching-parallel-agents after freezing the shared contract below.

**Goal:** Execute a prepared workout on the watch without phone availability and synchronize durably when the phone app opens.
**Architecture:** Project the remaining workout as ordered steps; execute and journal local actions atomically; replay validated ordered events into the phone's existing local store with persistent receipts.
**Tech Stack:** Existing Java 21 / Android SDK 35 / React JavaScript / Vitest / JUnit.
**Spec:** ../specs/2026-10-19-wear-standalone-design.md

## Global Constraints

- No new runtime dependency, backend, or account identifiers in wearable packets.
- Preserve advanced-set restrictions, sides, supersets, weight profiles and sensor consent.
- Write before acknowledging; never discard pending local work on a remote update.
- User explicitly authorized direct implementation without further approval prompts.
- Work on `codex/wear-standalone` in the existing checkout to avoid another large checkout after the requested cleanup. Keep progress in this plan and the project diary.

## Review Focus

- Phone restarts and replays after a lost ACK must not duplicate a set.
- Screen-off/disconnected watch must progress past one completed set.
- Phone edits or account/session replacement must preserve pending watch data as a conflict.
- Decimal load edits and unilateral/superset ordering must match phone rules.
- Local write failure and late snapshots must not report an action saved or roll back the watch.

## Task 1: Phone projection and event reconciliation

Files: `frontend/src/lib/wear-standalone.js`, its tests, `wear-protocol.js`, `wear-bridge.js`, bridge tests.
Interfaces: `projectStandalone(S, sessionId)` returns the spec's standalone object or null. `applyStandalone(S, command, sessionId)` returns a new S with `_wearStandalone` checkpoint; throws a coded error on malformed/conflicting input. Export runtime reducer if useful for shared fixtures. Bridge validates, updates once, flushes, then replies with stream/seq and publishes. Keep current v1 online commands compatible.

- [x] Add failing tests for sequence/rest projection, replay/idempotency, decimal edits, conflicts, wrong session and storage failure.
- [x] Implement pure projection/reconciliation and integration into global command serialization.
- [x] Verify focused Vitest tests and existing wearable regression tests.

## Task 2: Durable watch execution engine

Files: `WearStandalone.java`, Java unit/instrumentation tests under wear.
Interfaces: static `view(Context, JSONObject remote)` returns the merged local UI snapshot; `receive(Context, JSONObject remote)` accepts or protects the local session; `perform(Context, JSONObject event)` commits an event and returns boolean; `packet(Context)` returns next command or null; `acknowledge(Context, JSONObject reply)` applies an exact receipt; `pending(Context)`, `conflicted(Context)`, `available(Context)`, `discard(Context)` expose status. No transport or Activity ownership in this engine.

- [x] Add failing behavioral tests for start/complete/rest/pause/edit/restart/late snapshot/ACK rules.
- [x] Implement atomic persisted journal and the spec's runtime transitions.
- [x] Verify reducer tests against phone fixtures and storage instrumentation when available.

## Task 3: Native transport, UI and heart capture

Files: `WearActivity.java`, `WearStateService.java`, `WearBridgeService.java`, `WearBridgePlugin.java`, native guards, heart store/session integration, strings/tests.

- [x] Add regressions for starting and completing while disconnected, pausing rest and progressing to another set.
- [x] Route supported actions through local engine, keep advanced online fallback, replay after phone snapshots and app foreground, accept background ACKs.
- [x] Keep sensor optional, bind local captures to validated targets and preserve pending captures.
- [x] Verify UI regressions and phone/watch builds.

## Task 4: Final validation and delivery

- [x] Run web suite, scripts/locales, web/mobile builds, Java tests and available emulator tests.
- [x] Review full diff; fix material regressions and report remaining device limits.
- [x] Update diary/mobile docs with observed results, then launch the layout editor and request its page in the Codex panel (queued while task is hidden).

## Progress and rulings

- Initial diagnosis: startSet requires a fresh phone round trip and live heart data; the old outbox only queues one action and cannot advance locally. Phone WebView callbacks are necessary for current command completion. Native foreground protection therefore does not provide standalone behavior.
- Ruling: start an already prepared workout offline; selecting/creating a new routine remains on phone, consistent with the current available workout flow.
- Ruling: keep native rest deadlines absolute so reconnection never restarts or lengthens a completed break.
- Ruling: persist a private phone timer seed before publication and include its normalized signature in conflict detection. This preserves ordinary phone rest controls while protecting offline watch changes; concurrent explicit edits may require conflict review.
- Ruling: retain existing sensor consent and continuous heart recording semantics while effort stopwatch pauses independently. Sensor accuracy requires physical-device validation; no accuracy claim is made.
- Ruling: no new runtime library. The native unit tests use test-only org.json; this does not enter either APK.
- Task 1 complete: 66 focused wearable web tests, including real owner-store archive reload, actual UI timer import and duplicate replay.
- Task 2 complete: 20 new engine unit tests; wear unit suite 40/40. Storage commit failure/rollback and real SharedPreferences restoration pass on emulator.
- Task 3 complete: offline UI start/save/rest/next and paused effort/rest Activity recreation pass. Phone unit suite 6/6 and both APKs compile.
- Final review: independent reviewer found null timer target, phone timer projection and 900-second boundary issues; all fixed with RED→GREEN regressions. No deferred minor findings.
- Final verification: `vitest run --maxWorkers=4 --reporter=dot` → 356 files, 3905 tests passed (156.34s); six build-script tests; locales 17/2031; web/cloud and mobile bundle checks; final Android packaging all passed.
- Emulator: full suite 27/28 passed with one missing-notification-permission failure. After granting POST_NOTIFICATIONS only on the test emulator, affected background class passed 2/2. All 28 distinct cases have passing evidence; no physical device was connected.
- Delivery: local editor responds HTTP 200 at port 5178. Codex panel open returned queued for the hidden task. Test emulator stopped, editor server retained for the user.
