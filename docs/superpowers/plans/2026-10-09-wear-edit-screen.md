# Watch workout screen with repetitions/load editing

User approved the visual mockup and implementation on09/10/2026. They corrected the original phone-edit preference: edit repetitions and load on the watch itself. Use the current authorized checkout, preserve all existing changes, and do not publish/commit. APK installation remains deferred per the user's existing preference.

## Approved behavior

- Compact circular-screen layout: exercise, series, elapsed effort (or rest timer), tappable reps and load chips, one large main action. Dark background/yellow OpenGym action. Options and sensor controls live in a separate menu.
- Tapping a chip opens a draft editor with minus/plus, Confirm and Cancel. Confirmation sends to the phone; no optimistic persisted updates or offline edit commands. Cancellation changes nothing.
- Heart icon only on main screen: pulses when service running and valid sensor reading is <=15seconds old; gray/static otherwise. Accessible status and sensor/error details in menu. Animation represents receiving recent readings, not individual physiological heartbeats.
- Editing preserves current timer, capture, measured start timestamp and set completion state. Supported scope matches ordinary repetition sets, including a specific unilateral side. Unsupported cardio/timed/intensifiers retain phone handling.
- Incoming sync must retain an unrelated draft when only revision/timer/other-field changes. Changed owner/session/target/edited-field baseline or weight unit invalidates it; require reopening to avoid overwriting mobile edits. Pending edits cannot be adjusted or resent until confirmed/failed.
- Existing confirmed-start cancellation of prior rest must remain. Ordinary completion keeps existing configured rest behavior.

## Locked transport contracts

Snapshot `current` adds `repsValue` (finite number or null), `loadValue` (finite number or null), `loadUnit` ('kg'|'lb'), `loadStep` (existing weightIncrement of entry target/unit), `repsStep:1`, `canEdit` (supported repetition row AND registered UI editing handler ready; sheets/work disable it). Existing labels stay for compatibility.

Command `{v:1,requestId,contextToken,revision,action:'edit-set',target:{entryIdx,setIdx,side},field:'r'|'w',value:number,unit?:'kg'|'lb'}`. For weights unit must match current snapshot. Validate supported current exact target/revision/context; reject nonfinite, negative, >10000 values; reps must be integers. Zero is valid like phone number input.

Controller adds `editCurrent(target,command)`, routed before durable flush and deduplicated using existing controller results. Existing timer actions do not receive edit commands. Bridge exposes `registerWearEditing(handler)` alongside completion registration. Handler belongs to Workout and revalidates actual current target/readiness immediately before the synchronous store update.

Phone applies edits through existing workout rules: reps only patch target; weight sets manual-origin marker and invokes existing cascadeWeight including target side, maintaining side aggregates and inherited following-set behavior. No bespoke progression algorithm or health mutation. Reuse/extract a pure shared set-field helper if needed.

## Units of work

1. Phone JS: meaningful RED/GREEN protocol projection/validation, controller dedup/durable-write/handler, bridge editing readiness and Workout regression for normal/side weight inheritance. Own wear-protocol/session/bridge, new pure helper if needed, Workout wiring and related tests.
2. Watch Java: pure editor/heart-freshness model tests RED/GREEN; compact UI + draft editor + options; decimal steps/unit from snapshot; preserve draft under periodic sync; integrate edit-set envelope and pending/rejection paths. English/Portuguese resources. Own wear module only.
3. Root integration: inspect actual final diffs, independent review scoped to edits/lifecycle/owner/capture invariants, focused JS/Java/native UI tests as available, mobile byte-identical build and both APKs. Retain truthful physical verification limits while installation is deferred.

Verification must cover stale target/revision/unit rejection, concurrent mobile field edits, unrelated sync preserving draft, cancelled edit unchanged state, side aggregates/manual weight cascade, timer/capture unchanged on edit, command dedup and failed durable save, animation stale/stop lifecycle, adequate round-screen safe insets and usable touch targets. No permanently held wake lock or always-on display feature in this scope.
