# Retired HTTP API

The Node HTTP account/pairing, whole-profile sync, media upload and Coach API are not part of this adaptation. Their package, OpenAPI generator and generated website reference were retired. There is no replacement `/api` proxy.

The official Firebase SDK supplies configured Auth/Firestore access under `users/{uid}/apps/opengym`; see the approved design and README.md. Shared backups remain training-only. Existing raw legacy files are recovery evidence and must not be deleted or relabelled as Firebase ownership.
