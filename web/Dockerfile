# Static React/Firebase frontend. Public Firebase values are compiled by Vite.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
ARG APP_BUILD=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
RUN npm run build && npm run check:cloud-bundle

FROM nginx:alpine
RUN apk upgrade --no-cache
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="opengym-offline-web" \
    org.opencontainers.image.description="Offline training with optional Firebase synchronization; own media stays local" \
    org.opencontainers.image.authors="Adapted from openGym by Duarte Santos; see NOTICE.md" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 web/05-check-base-path.sh /docker-entrypoint.d/
COPY --from=build /app/frontend/dist /usr/share/nginx/html
ENV NGINX_PORT=80
ENV BASE_PATH=""
HEALTHCHECK --interval=5m --timeout=5s --retries=3 \
    CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}${BASE_PATH}/" || exit 1
