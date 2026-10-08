# Retired artifact and regression map

Task 10 removes tracked source through Git only. It does not delete ignored user/data/media directories, native archives, raw legacy recovery files or unknown evidence. LICENSE and NOTICE.md remain unchanged. Original source remains recoverable in Git history.

## Production boundary

| Retired artifact | Last production consumers | Retained boundary |
|---|---|---|
| Seven lib/coach modules | Coach imported itself; coach-local imported API core, native-fetch and secure vault. No retained app entry imported Coach. | Exercises, history, routines, queue/rotation, units, progression, 1RM, media, QR and sharing remain. Coach-authored training remains recoverable. |
| lib/api.js, remote.js, push.js, capacitor-fetch.js | API used capacitor-fetch; remote/push used API; Coach used API/native-fetch. No retained production consumer remained. | Existing app-base.js pure helper; official Firebase SDK; local Android notifications/rest guards. |
| lib/update.js and InstallPlugin | No retained UI import; stale tests/mocks and MainActivity registration only. | PWA updates, FileProvider/cache paths and Share. No upstream APK updater or install-packages permission. |
| lib/audit.js | Removed Admin view; no retained production consumer. | Server activity UI is retired. |
| api/, mcp/, API/Coach generators, root js-yaml manifest/lock, website/api.html | Old backend/Coach/MCP pipeline; build-api-docs was sole root js-yaml consumer. | Catalogue/translation/name/instruction generators and shared helpers; original media-reference fixture relocated under frontend. |
| secure-storage dependency/native links | coach-secrets only | Barcode, app, filesystem, local-notifications, share, Firebase12.19.0 and Capacitor7.6.9 remain; scoped gRPC1.13.6 override unchanged. |

## Test disposition

- All 24 exact `useStore.mobile-remote.test.jsx` labels are mapped in [NATIVE_REGRESSION_MAPPING.md](NATIVE_REGRESSION_MAPPING.md). New native composition runs 15 cases across N1–N10. No pairing/Bearer/61-second abort shim returns.
- Coach-exclusive tests (`coach-api.i18n`, `coach-demo`, `coach-local`, `coach-parity`, `coach-insights`, `coach-secrets`) and updater tests retire with those features. `drop-label.test.js` retains its all-locales drop-set assertion; only the Coach removal-title assertion leaves.
- API-only tests `api.test`, `api.mobile`, `api.media`, `api.pair-insecure`, `api.pair-probe`, `remote.test`, `push.test`, `capacitor-fetch.test` retire passkeys, pairing, Bearer/cookie transport, uploads, Web Push and provider timeout behavior. `audit.test` retires old server activity labeling.
- Mixed `api-base.test.js` retains root/subpath/odd-location assertions against existing `app-base.js`, nginx rewrite/cache/relative redirects and BASE_PATH validation. Old activity beacon and backend proxy-target tests retire; static no-API/build-config acceptance replaces them.
- `useUI.native-rest`, `useUI.pause`, `useUI.rest-reload` retain timer/native arm/hold/disarm and absence-of-push expectations. Absence now observes actual global fetch, rather than an unconsumed deleted-module mock. Other stale API/push/Coach/updater component mocks leave while their assertions remain.
- `sw.test.js` preserves failing-install/old-cache safety, no push/subscription handlers, notification-click support and historical device-cache retention. Retired page-module parity becomes a fixed historical cache-name assertion; unused rotation setup leaves.
- `media-refs.test.js` retains every hash/ref/URL assertion; its original JSON fixture moves to `src/lib/test-fixtures/media-refs.json`.
- `sync-stamps-parity.test.js` retains both add-back/tombstone tie and Undo merge-order tests plus no-write-ID backup stamping. Cross-implementation parity and five old server stampPut cases retire: planner input, unstamped old-app delete/setting, old-app revival, pyramid retention on old server save, stale setting protection. No server helper copy is introduced.
- `sync-routine-order.test.js` retains all six ordering tests and useful expectations. First peer fixture now calls `stampChange(cur,old,T+3000)`; second stamps the added routine against its actual `base()` then `mergeStates(old,cur)`, preserving exact `c,z,b,a`. Only duplicate server orderMoved parity leaves.
- `views/undo-concurrent.test.jsx` retains all assertions, including both legacy unstamped rename scenarios. For the same merged peer fixture, `pushed._ts=stampChange(server,pushed,Date.now()+1)` replaces server stampPut. No production merge helper is changed.

## Old randomized simulator

`sync-fuzz.test.js` implemented its own 2–3-device store and whole-profile Node PUT/baseRev409/retry server, resetIds and shared-media convergence. It ran neither real store nor canonical codec/bridge. Its five campaigns (short gaps, long gaps, resets, unit switches and day-skew clocks) retire as obsolete protocol simulation. Deterministic replacements do not reproduce the randomized breadth; that coverage is explicitly lost.

Retain `sync-merge.test.js` (union/dedup/date keys, edits/deletes/revival, independent fields, causal stamps, settings/week/notes, queue, unseen re-star), `sync-routine-order.test.js`, `cloud/codec.test.js` (all families, granular paths, tombstone replay, local-media exclusion, numeric conversion), `cloud/sync-bridge.test.js` (offline reload, delayed/duplicate ACK, failed ACK replay, simultaneous drafts) and `cloud/sync-jobs.test.js` (generation reset, conversion/relabel, cleanup races). New `cloud/codec-favourite.test.js` runs real codec: base empty at1, phone star at10/unstar at20, tablet unseen re-star at30. Star survives; operation and written documents contain only exerciseState/YmVuY2g.

## Shipping

GitHub Docker/Pages/mirror and Gitea publisher workflows are removed. GitLab only builds/tests, with no registry, package, artifact, Pages, release or mirror upload. Unsupported Kubernetes manifests and stale rendered diagrams retire; current Mermaid diagram sources remain. Historical website material is labeled and excluded from static build context.

Android is the default fresh native copy; iOS requires explicit macOS sync/check. Docker compiles public Firebase configuration in its build stage; nginx has no API proxy. Canonical full-suite and actual device/emulator QA remain separate from Task10 scoped regressions/builds.
