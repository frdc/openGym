# Native regression retirement map

The legacy useStore.mobile-remote.test.jsx had 24 cases. These exact labels are mapped below before retirement. N1–N10 refer to named cases in frontend/src/store/useStore.native-cloud.test.jsx (15 executions including variants). The real store, codec, bridge and createFsStorage run over a fake Filesystem and shared owner-bound remote ports; this is not physical device or Firebase rules proof.

Snapshots copy confirmed filesystem bytes before disposal; unconfirmed memory is never promised to survive process loss. Keep/Add and confirmed Firebase Auth replace Node pairing authority. firestore-port.test.js remains the authority for raw invalid-record rejection.

| # | Exact retired label | Replacement / retired contract |
|---|---|---|
| 1 | keeps the pairing, the account and the data, and says the server refuses this phone | Retained sync-status: surfaces unauthenticated; only confirmed Auth signout. N1 |
| 2 | a change made meanwhile goes to the paired server with the token, and stays owed | Retained sync-status: saved locally and pending cloud; N1 |
| 3 | a phone that last synced under an older version knows a change is owed, not how many | Retired Node fingerprint count inference; canonical queue debt covered by N1 |
| 4 | the next cold start asks the server again, and heals by itself once it accepts the token | N1 |
| 5 | a 200 page that is not the server's answer is an error, not a sign-out | N9 plus firestore-port malformed canonical/singleton validator tests |
| 6 | mid-session, a refused push and a refused pull say so instead of passing in silence | Retained sync-status error/debt tests; N1 |
| 7 | is recognised at boot: its data is owed, nothing goes to the app's own asset server, and it asks to be paired again | Retained cloud unknown recovery and legacy migration; N2 |
| 8 | pairing it again with the same account merges the week, the routine edits and the settings — no question asked | N2 (explicit Add replaces unsafe automatic UID admission) |
| 9 | Disconnect does not wipe the week the server never saw | Retained sync-status ordinary owed signout and failed durability; N3 |
| 10 | stashes them in storage and in a file, wipes the phone, and merges them back when paired to the same server and account | N1 and N3 |
| 11 | killed straight after, the next start is local and empty: the account's copy is in the stash, not back on the screen | N3 |
| 12 | a stash for another account stays where it is | N3/N6 plus retained recovery-ui known-owner privacy |
| 13 | keeps the first account's changes aside under its own server, and gives them back when it pairs again | N3/N6 plus retained restore same-owner test |
| 14 | with localStorage gone, a change only the mirror holds is merged with the server copy and pushed | N1 |
| 15 | an ordinary start, mirror and storage in step, pulls as before and pushes nothing | N4 |
| 16 | with storage behind the mirror (a save it refused), the mirror's change is merged with the server copy, not pushed over it | N5 |
| 17 | another account paired, then the app killed at once: the next start keeps her copy, and nothing of his reaches her account | N6 |
| 18 | another account paired while the file cannot be written: his copy left in it is never taken for hers | N6 ENOSPC variant |
| 19 | a phone that kept its own workouts out of the account does not push them in on the next start | N7 guest and unknown variants |
| 20 | a copy adopted from the server with an older clock stays adopted after a kill straight after | N8 |
| 21 | with the file not writable at all, the copy before the adopt is merged at most — never pushed over the other device's work | N5 all-writes variant |
| 22 | is saved to the pairing file at boot and carried by every request after it | Retired Node pairing-token renewal; no SDK credential shim |
| 23 | an answer without one leaves the pairing as it was | Retired Node pairing-token fallback; no SDK credential shim |
| 24 | gives up after its timeout: the change stays owed, the phone says it is offline, and the next push goes out | N10 supported deferred-response/independent recovery contract; Node 61s abort retired |
