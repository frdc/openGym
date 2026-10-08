# FAQ

**Can I use it offline?** Yes. Training saves to a local archive. Web uses IndexedDB; Android uses native files. Saved locally does not mean acknowledged by the cloud. A failed native write is reported and must be retried; unsaved memory cannot survive a killed app.

**Do I need an account?** Local mode needs none. A fully configured build can use Firebase email/password Auth and Firestore synchronization. Only confirmed Auth establishes account ownership. Old pairing tokens and Node UIDs are not Firebase authority.

**Where is my data?** Each guest/account has its own archive. Cloud records are scoped under `users/{uid}/apps/opengym`. Unknown old files are preserved for explicit recovery Add/Keep. Ordinary signout refuses owed changes; a permitted forced signout keeps the confirmed archive under its original owner.

**Do my photos and videos sync?** Own media stays local in this version. Export ZIP backups to retain available bytes along with training. Missing originals cannot be downloaded from a server. Catalogue exercise images/GIFs continue to use their existing local/CDN sources and separate licences.

**What happens to backups?** JSON contains training state, not account identity, tokens or sync queues. Keep regular exports. Removing app storage can remove local-only media and archives. Physical media deletion is deliberately deferred when safe retention cannot be proven.

**Are reminders retained?** Android local reminders, rest alarms and session timer safeguards remain. The old server Web Push delivery is retired.

**Where are Coach, passkeys, MCP and the APK updater?** They belong to the retired server edition. There is no adapted automatic update/download channel yet. Upstream releases are historical attribution.

**Is iOS validated?** No. Native iOS sources are retained; a fresh macOS sync/build and separate validation are required before shipping. The web/PWA remains a separate target.
