# Wear heart rate with recovery — Implementation Plan

> **For agentic workers:** Use the established implementation workflow and meaningful RED→GREEN checks. Domain/storage, view and native units have explicit interfaces and can be developed independently.

**Goal:** Record effort and recovery heart rate for explicitly marked sets, preserving timestamps, owner isolation and existing training behavior.

**Architecture:** A Wear OS Health Services foreground service collects heart rate through exercise/recovery. The phone confirms start/cancel/complete and associates packets with a durable owner-scoped native binding journal. Public `heartRate` on each set/side contains measurements only; transport bindings remain outside training exports.

**Tech Stack:** Current React/JS/Capacitor7.6.9, Java21/SDK35, official Health Services1.1.0 if compatible with SDK35 (verify its AAR metadata before adding). No production setup.

**Spec:** `docs/superpowers/specs/2026-10-09-wear-heart-rate-design.md` (including user's recovery correction).

## Constraints and interfaces

- Preserve existing timers, series rules, units, progression and opaque owner/session guards. Current checkout is already the authorized working directory; .git denied worktree creation previously. Preserve existing changes.
- Public measurement: `{v:1, source:'galaxy-watch', startedAt:number, effortEndMs:number|null, recoveryEndMs:number|null, endReason:string|null, status:'pending'|'partial'|'complete'|'empty', points:[[elapsedMs,bpm]], effort:{count,mean,peak}|null, recovery:{count,mean,peak}|null, milestones:[{seconds,atMs,bpm,delta}]}`. Max300 plotted points; reductions retain boundary/extrema, summaries from all received valid samples. Complete marks require enough readings; missing phases do not get fake zero.
- Private binding journal: plugin `getHeartBindings({ownerKey}) -> {bindings:{token:{startedAt,sessionId,nodeId,contextToken,...}}}` and `saveHeartBindings({ownerKey,bindings})`; atomic commit. No identities/bindings enter public measurements or backup files.
- Snapshot optional `heartCapture:{token,startedAt,phase:'effort'|'recovery',effortEndMs:null|number}`. It remains the previous marked set during recovery, even when current exercise changes. Owner/session invalidation closes capture; it must not start a health FGS from a background callback.
- Commands `heart-start` and `heart-cancel` use existing v1 request envelope/target. `heart-start.startedAt` is the watch's actual tap timestamp. Normal complete may carry `heartElapsedMs`; optional capture requires target validation. RequestId is deduplicated before mutation. Start returns `heartCapture` in published snapshot after durable binding and local set marker confirmation.
- Measurement packet path `/opengym/v1/heart`: `{v:1,requestId,token,measurement:{startedAt,effortEndMs,recoveryEndMs,endReason,partial,points}}`, points max300 within16KiB, incremental final bounded cumulative series snapshot. Phone merges/recomputes summaries before durable save; reply path `/opengym/v1/heart-ack`, `{v:1,requestId,status,token}`. A receipt is acknowledged only after durable persistence. A final packet retires queue only after acknowledgment; old incremental acknowledgments must not retire final capture.
- Phone health host module exposes `createWearHeartSession({getStore,plugin,changed}) -> {handle(command,nodeId),complete(command,nodeId),receive(packet,nodeId),projection(),reconcile(),dispose()}`. It owns native journal loading and owner checks. Bridge routes health commands/payloads and delegates ordinary complete with `complete` before current toggle. `reconcile` closes effort for a phone-marked done row and closes recovery on next confirmed start/end, while invalidating discarded rows/sessions.
- Native pending captures limited200/2MiB, private persisted queue, no offline conclusion commands. UI permissions can be denied while ordinary logging continues. No takeover of another app's Health Services exercise. No permanently held wake lock.

## Review focus

1. Owner switched while packet/save in flight: never attach to another owner or acknowledge wrong persistence.
2. A row removed/moved or workout finalized: find the stable startedAt marker rather than trusting stale indices; finalized measurements still attach to intended historical set.
3. Batched timestamps and recovery: finish/next-start boundaries exclude effort/recovery cross-contamination; paused/expired rest timer does not close recovery.
4. Process death/disconnection: queue and binding journal recover; duplicate/stale packets cannot regress a completed capture.
5. Denied/revoked permissions, unavailable readings, other health app: continue training and mark missing/partial without invented values.

## Task1: Phone measurement/domain and durable binding

Files: new `frontend/src/lib/heart-rate.js`, `heart-rate.test.js`, `wear-heart-session.js`, `wear-heart-session.test.js`; modify `wear-bridge.js`, `wear-protocol.js`, relevant bridge tests. Native private journal methods are Task3's interface.

- [ ] Write failing tests for boundaries, milestones nearest±5s, no readings, point limits, packet dedup, owner changes, moved/deleted rows, finalized workout, codec/backup round-trip without tokens.
- [ ] Run relevant Vitest files and observe RED.
- [ ] Implement validated measurement aggregation and host; use existing owner-scoped store update/flush. Do not copy progression logic.
- [ ] Run GREEN and affected existing tests; record limitations honestly.

## Task2: Cellphone visualization

Files: new `frontend/src/components/HeartRateSummary.jsx` and meaningful rendering tests; modify `frontend/src/sheets.jsx` workout detail and `frontend/src/views/Workout.jsx` completed-set overview. Add exact translations in all existing locales, with explicit pt-BR overrides.

- [ ] Test empty/partial summary, separated effort/recovery, real milestone times and graph boundary.
- [ ] Render a compact accessible SVG chart, means/peak and recovery landmarks; never color-code as health judgment.
- [ ] Integrate by reading only `set.heartRate` / `set.sides.L/R.heartRate`; do not alter stored data or press completion controls from chart.
- [ ] Run component tests and locale checker.

## Task3: Watch collector, controls and native transport

Files: new Wear `WearHeartService.java`, `WearHeartStore.java`, relevant JVM/instrumentation tests; modify `WearActivity.java`, `WearStateService.java`, manifest/build and strings. Phone `WearBridgePlugin.java`, `WearBridgeService.java`, guard tests add private journal and heart routing.

- [ ] Test phase boundaries, packet retention until final ack and timestamp conversion before implementation.
- [ ] Add official Health Services with capability/other-exercise checks and proper health FGS, runtime permission requested from visible activity. Keep sensors optional and stop on session invalidation/destruction or permission loss.
- [ ] Start/cancel UI marks effort and normal completion marks recovery; next start/end closes previous phase. Collect elapsedRealtime sensor timestamps, not callback receipt times.
- [ ] Persist queue atomically and send cumulative bounded packets, replay safely, accept only trusted phone ack. Implement owner-private binding journal on phone.
- [ ] Compile/test Android modules; resolve SDK/dependency/permission mapping against actual Ultra.

## Task4: End-to-end and delivery

- [ ] Independently review full change, fix important findings with regression tests.
- [ ] Full JS suite, build-scripts/locales/build/mobile/cloud checks, relevant JVM/instrumentation tests and APK signatures.
- [ ] Install test APKs with -r on identified phone/watch. Request sensor permission through user UI, not adb granting it silently. Verify actual readings (requires watch worn), effort→recovery→next-set, screen off, denied/read failure and saved detail graph.
- [ ] Update `docs/dev/WEAR_OS_VERIFICATION.md`, include physical evidence vs pending checks. Do not claim synthetic data is live sensor proof.

## Execution authorization

User explicitly authorized both planning and implementation in this turn after approving the design and recovery correction. Proceed without another approval handoff; this direct instruction overrides skill-level plan-review pauses. Working units use the above interfaces and a final independent review.
