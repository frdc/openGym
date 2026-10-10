# Repository guidance

This is the approved React offline/Firebase adaptation of openGym, licensed AGPL-3.0-or-later. Read README.md and the approved design before changing data contracts.

## Layout

- `frontend/`: React 19, Vite, Zustand, official Firebase SDK; `src/lib/cloud` owns codecs, local envelopes, Auth and sync. `src/store/useStore.js` publishes current-owner state and readiness; `useUI.js` owns ephemeral UI and timers.
- `frontend/android`: Capacitor Android, Java 21, SDK 35. `frontend/ios` is retained source, not currently validated.
- `web/`: static nginx Docker build, no backend proxy. Compose also downloads catalogue media.
- `docs/`: current guides and approved design. `website/` and old changelog assets are upstream historical material, excluded from adapted shipping/publishing.

## Commands

Run from `frontend`: `npm ci`, `npm test`, `npm run test:build-scripts`, `node scripts/check-locales.mjs`, `npm run build`, `npm run check:cloud-bundle`, `npm run build:mobile`.
Run `android/gradlew --no-daemon -p android assembleDebug` separately with Java 21 and SDK 35. On Windows use `android/gradlew.bat`. Device/emulator QA is separate from compilation.

Vitest defaults to `min(4, availableParallelism())` workers to avoid resource-driven native-import timeouts on Windows. This may trade peak throughput for reproducibility on large hosts; CI with fewer CPUs uses its available capacity. Do not increase timeouts or suppress warnings to claim green.

## Rules

Keep dependency additions narrow: the adaptation adds only exact official `firebase`; Capacitor stays on the reviewed 7.6.9 line and the scoped Firestore gRPC override is documented in docs/dev/DEPENDENCY_OVERRIDES.md. Do not add TypeScript or unnecessary libraries.

Anything deciding what to lift next or reading a logged session belongs in a pure helper with meaningful tests. Preserve exercises, history, progression, units, workout-model, onerm, queue/rotation, share/QR and native timers. Native timer messages require current owner/session context and opaque tokens.

Persist state and affected-document intent atomically; confirmed Auth is ownership authority. Shared exports must not carry tokens, identity or transport metadata. Preserve unknown legacy sources and recovery archives. Own media stays local and scoped to its owner. Never delete ignored user data or native evidence as source cleanup.

Match existing JS/JSX style; no configured linter/formatter. New UI strings must pass every locale including pt-BR inheritance. Do not commit media/data, private environment files, signing keys, QA profiles or logs. Keep LICENSE and NOTICE intact.

CI builds/tests only. Publishing, registry uploads, Pages, mirrored pushes and release jobs were removed pending an explicitly reviewed adapted channel. Production Firebase/rules/billing/migration needs separate authorization. See CONTRIBUTING.md and docs/NATIVE_REGRESSION_MAPPING.md for preserved regression contracts.
