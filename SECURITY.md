# Security scope of this adaptation

The active product is a static React frontend with local owner archives and optional Firebase Auth/Firestore. The old Node API/passkeys/Coach/Web Push security model is retired. There is no adapted production deployment or automated update/release channel asserted by this repository.

Treat public Vite Firebase values as public configuration; never place private service-account credentials, signing keys or personal data in them. Only confirmed Auth selects an account. Store/rules tests must preserve the namespace users/{uid}/apps/opengym and deny foreign-owner access. Shared training backups exclude identity/tokens/queues. Native file persistence and local media remain sensitive data on the device.

Do not modify deployed Firebase rules, accounts, billing or production data as a build/test step. Local emulator verification uses the demo-opengym project; device/offline testing is separate. Report suspected issues privately to the maintainer of the adaptation being used, with a minimal reproduction and affected build, without real credentials or personal training payloads.

Upstream attribution and licence remain in NOTICE.md and LICENSE. Historical upstream releases and registry images are not an update channel for this adaptation.
