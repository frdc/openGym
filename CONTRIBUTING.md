# Contributing

Use Node 22 and work in `frontend/`. `npm ci`, `npm test`, `npm run test:build-scripts`, `node scripts/check-locales.mjs`, `npm run build` and `npm run check:cloud-bundle` verify the web artifact. Android additionally needs `npm run build:mobile`, Java 21 / SDK 35 and a separate Gradle `assembleDebug`; physical behavior still needs device QA.

Keep training logic in pure helpers with tests beside it. Match the existing JavaScript style and keep dependencies narrow. The adaptation adds only the official Firebase SDK. New user-facing text belongs in all locales, including pt-BR inheritance. Preserve local owner isolation, granular queued operations, recovery evidence, offline media and native timer tokens.

Do not commit personal data/media, environment secrets, signing keys, emulator profiles or test logs. Preserve AGPL and NOTICE attribution. Review browser behavior for UI changes and report actual test/build evidence and remaining limits in pull requests.

The active artifacts are the React web/PWA and Capacitor Android app. The Node API, AI Coach, vault, server Web Push and MCP are retired. CI contains frontend/locales/build checks and Android compilation, with no automatic upload/deploy/release/mirror channel. Do not interpret an upstream website or APK as an adapted release.

See [README](README.md), [architecture guidance](CLAUDE.md) and [native regression map](docs/NATIVE_REGRESSION_MAPPING.md).
