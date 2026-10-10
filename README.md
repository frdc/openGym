# OpenGym

Aplicativo pessoal para registrar treinos, organizar rotinas e acompanhar a evolução. Disponível na web/PWA, Android e em um app acompanhante para Wear OS. Funciona com armazenamento local offline e oferece sincronização de dados de treino por Firebase quando configurado.

## Funcionalidades

- Registro e edição de treinos, exercícios, séries, cargas, repetições e esforço (RPE/RIR).
- Rotinas, planejamento e rotação de treinos, com progressão de cargas e histórico.
- Séries de aquecimento, supersets, exercícios unilaterais, dropsets, rest-pause e exercícios por tempo.
- Temporizadores de trabalho e descanso, com notificações e alarmes locais no Android.
- Catálogo de exercícios, filtros por músculos/equipamentos e exercícios personalizados.
- Acompanhamento de peso corporal, medidas e fotos de progresso.
- Fotos e vídeos associados aos treinos, armazenados localmente.
- Importação/exportação de backups, compartilhamento por QR e exportação de planos para impressão/PDF.
- Conta por e-mail/senha e sincronização Firestore, com dados locais separados por conta e recuperação de gravações.
- Temas, unidades configuráveis e suporte a múltiplos idiomas, incluindo português brasileiro.

## Wear OS

O app acompanhante mostra a série atual, permite editar carga/repetições, concluir séries e controlar o descanso. A coleta opcional de frequência cardíaca registra resumos e gráficos de esforço e recuperação nas séries.

O celular continua responsável por salvar e finalizar o treino. Os controles dependem da conexão e do estado do app Android; não há fila de conclusões offline. Séries especiais podem exigir o celular. A versão web não controla o relógio. Veja os registros de validação e limitações em [docs/dev](docs/dev/WEAR_HEART_RATE_VERIFICATION.md).

## Identidade do aplicativo

Android e Wear OS usam `com.fredc.opengym`; builds debug usam `com.fredc.opengym.test`. Os dois APKs precisam usar o mesmo identificador e certificado para comunicação.

A mudança do identificador cria uma instalação separada da versão anterior. Transfira seus treinos por backup ou sincronização antes de deixar de usar a instalação antiga.

## Data and accounts

The app saves a complete local archive before reporting Saved locally. Web uses IndexedDB; Android uses owner-separated, checksum-verified native files with two recovery slots. A local save and a cloud acknowledgement are distinct states. Signing in uses Firebase email/password Auth when public configuration is supplied. Only confirmed Auth selects an account; changing accounts never assigns another account's archive to the new owner.

Cloud records live under `users/{uid}/apps/opengym`. Synchronization queues granular operations for affected documents; shared backup JSON contains training state, not identity, tokens, transport queues or synchronization metadata. Unknown legacy files remain recoverable and require an explicit Add/Keep decision. Keep preserves the source without uploading it. Keep backups before any transition; unconfirmed memory edits cannot survive a killed process.

Own photos and videos remain local to their owner in this version. They are not uploaded to Firebase or the retired API. Use ZIP exports for training plus available media. Missing original bytes remain visible as missing references; no cloud download can recreate them. Physical media garbage collection is conservatively deferred while recovery references or concurrency are uncertain. The exercise catalogue may still use its existing remote image/GIF sources.

## Local development

Use Node 22. From `frontend`:

```sh
npm ci
npm run dev
npm test
npm run test:build-scripts
npm run build
npm run check:cloud-bundle
```

No Firebase values are needed for ordinary local mode. For configured builds, copy `frontend/.env.example` to `frontend/.env.local` and supply all four public web-app values: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Never place service-account credentials in Vite variables. Runtime deliberately falls back to local mode for incomplete config; the artifact checker rejects incomplete build configuration to prevent accidental release mistakes. Build metadata records the public configuration and mode.

This repository does not activate production Firebase, create accounts, deploy rules, enable billing or migrate existing production data automatically. Emulator QA uses only `demo-opengym` and remains a separate verification step. Ordinary local builds and demo builds are not account-flow verification.

## Static hosting and Android

`docker compose up --build` builds the static frontend and serves it with nginx; the separate media service downloads catalogue media. There is no application API container or `/api` proxy. Firebase values are Docker **build arguments**, not nginx runtime configuration. See [self-hosting](docs/SELF_HOSTING.md).

`npm run build:mobile` builds and syncs Android, then checks every copied asset and all service-worker chunks. It does not compile an APK. Use Java 21 / SDK 35 and Gradle `assembleDebug` separately; see [mobile builds](docs/MOBILE.md). iOS source is retained for a future explicit macOS sync/validation, not covered by Android checks.

## Removed features and publishing

The old Node account/pairing API, passkeys, server Web Push, AI Coach, secret vault and MCP server are retired from this adaptation. Local Android reminders/rest alarms remain. The upstream APK updater and installer permission are removed until an adapted update channel is reviewed. GitHub/Gitea registry publishing, Pages deployment, GitLab releases/uploads and upstream mirroring are disarmed; retained CI checks only build and test. No automatic production or release channel is configured.

## Guides and attribution

- [Documentation](docs/README.md), [FAQ](docs/FAQ.md), [contributing](CONTRIBUTING.md)
- [Native regression mapping](docs/NATIVE_REGRESSION_MAPPING.md), [retired source mapping](docs/RETIRED_ARTIFACTS.md)
- [Approved architecture](docs/superpowers/specs/2026-10-07-react-offline-firestore-design.md)

Este repositório mantém uma versão pessoal do OpenGym. A origem do código e os créditos de terceiros estão em [NOTICE.md](NOTICE.md); a licença está em [LICENSE](LICENSE). Dados e mídia do catálogo têm termos próprios. Os registros de verificação históricos podem mencionar identificadores e versões anteriores.
