# Static hosting

The adaptation serves only static React files and optional catalogue media. There is no Node API, server data directory, Coach credentials or `/api` reverse proxy. Existing user data directories are not automatically migrated or removed.

Copy the root `.env.example` to `.env` for Compose. Leave all Firebase fields empty for local mode, or supply all four public values from an already authorized Firebase web app. `docker compose up --build` builds the frontend and nginx, plus a one-shot catalogue media download. The web service uses a local build rather than an upstream registry tag.

Firebase `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID` are passed to the Docker BUILD stage. Changing nginx runtime environment cannot change the compiled SDK configuration; rebuild to change it. These are public web-app values, never service-account/private credentials. Build checking rejects incomplete public configuration. Configuring a project does not provision Auth, rules or billing; those actions are separate and are not automated here.

Runtime nginx variables: `NGINX_PORT` (default 80) and `BASE_PATH` (empty or e.g. `/gym`, no trailing slash). `WEB_PORT` selects the host port. TLS and Firebase authorized-domain configuration belong to the reviewed deployment setup. For a reverse proxy that strips the prefix, leave `BASE_PATH` empty. Hash routes load the shell; missing JS/CSS/media return 404. Shell/code revalidate; catalogue media uses long caching.

Catalogue media mounts remain read-only in nginx. Metadata/instructions and images/animations have different licences; see NOTICE.md. No own-media upload route exists. Local archives and media live on clients; server directory backups do not replace client JSON/ZIP exports.

The service worker precaches every emitted JS/CSS chunk, including locale/instruction/name packs. This increases first-install storage/network cost; external catalogue images/GIFs remain demand-cached rather than wholesale precached. A failed code fetch preserves the prior working worker.

Release publication, GHCR/Pages/GitLab/Gitea uploads and upstream mirrors are disabled pending a reviewed adapted channel. Do not use upstream `latest` images to update this adaptation. No container runtime verification is implied by a Vite build.
