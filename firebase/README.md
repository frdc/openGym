# Isolated OpenGym Firestore emulator rules

`emulator.json` loads `opengym.rules` only for local Auth (127.0.0.1:9099) and Firestore (127.0.0.1:8081), using the explicit project `demo-opengym`. Run from the repository root with the official Firebase CLI and Java 21:

```sh
firebase emulators:exec --project demo-opengym --config firebase/emulator.json --only auth,firestore "npm --prefix frontend run test:firestore"
```

The script refuses other project IDs or emulator addresses before initializing the SDK. It creates disposable Auth users and data, verifies the official Node SDK transport with its scoped gRPC override, and terminates/deletes every SDK client. Expected permission and size failures produce SDK error diagnostics. Emulator contention behavior does not certify production transaction contention.

This is an **emulator protection fragment**, not the deployed production rules. Reconcile it with the actual production rules before any activation. Firestore grants access when any overlapping `allow` expression succeeds; an `allow ...: if false` cannot cancel that grant. See the official [overlapping match statements](https://firebase.google.com/docs/firestore/security/rules-structure#overlapping_match_statements) explanation. A broader production match could therefore bypass these restrictions. No deployment, legacy migration, billing change, or production activation is part of this configuration.

Only the owner may access `users/{uid}/apps/opengym` and the listed domain subcollections. Control and record envelopes, payload shapes, generation, unit version, and atomic revision advancement are checked. Bounded import/unit job manifests and parts, reset generation transitions, and guarded cleanup of older-generation records have explicit rules. Unit records require the corresponding job-part transition; ordinary writes require coherent control revision advancement. Legacy collections are denied in this isolated emulator ruleset; that makes no claim about their unknown deployed rules.

Every active-generation record returned by a profile query is validated. A record missing `generation`, using the wrong generation type, or belonging to another generation is outside that query's view; this is not a corruption inventory of all stored data. An existing control remains initialized even when that view is empty. A directly affected record is validated before a transaction writes; valid older records may be replaced after a reset, while future-generation records are rejected.

The adapter rejects a serialized document above 900 KiB with its relative path and leaves the pending local payload recoverable. Firestore rules cannot measure a map's serialized byte length; the actual emulator backend separately tests the Firestore 1 MiB rejection. The SDK also enforces Firestore encoding constraints. No data is truncated to pass either limit.

## Review the combined rules before activation

The actual deployed legacy rules remain **unknown**. A source-only inventory of the legacy repository at `8002fbaf7136237e011217ffdb12b693b4383b6e` found no versioned rules/deployment configuration; repository absence does not establish deployed permissions. No Firebase Console or production database was inspected.

Obtain the authoritative rules for the intended project/database and review a combined candidate before any deployment. Preserve the old rules outside the new namespace and evaluate every match that overlaps it. Run the following cases against that complete candidate in an isolated emulator; these combined-rule cases are requirements, not results observed in this delivery:

| Combined-rule case | Required observation |
| --- | --- |
| Broad owner grant such as `/users/{uid}/{document=**}` also matches OpenGym | Owner writes with malformed fields, stale generation, missing control increment, illegal job transition, or forbidden physical deletion must still fail. A broad owner grant would otherwise bypass the new validation. |
| Broad authenticated/global grant such as `/{document=**}` or `/users/{uid}/apps/{app}/{document=**}` | Anonymous and other-UID read/write/query denial must hold for control, every record family, jobs, parts, unknown families, and deeper descendants. Inspect the grant union; adding a deny is insufficient. |
| Existing catch-all deny with new explicit OpenGym grants | Intended owner reads and coherent transactions succeed; the catch-all deny does not override a matching grant. |
| Legacy profile absent, valid, or restricted | Establish whether existing policy requires `/users/{uid}` or another legacy profile prerequisite. This fragment checks Auth UID and does not impose such a prerequisite. Preserve or explicitly resolve the authoritative policy before activation. |
| Legacy user root and collections | Existing allowed and denied reads, queries, creates, updates, and deletes retain their outcomes at `/users/{uid}` and immediate `exercises`, `workouts`, `workoutSessions`, `medicines`, `medicineLogs`. OpenGym never writes these paths. |
| Other app namespaces and top-level collections | Their existing authorization behavior stays unchanged; OpenGym grants apply only inside `users/{uid}/apps/opengym`. |

The fragment-only emulator tests cannot prove legacy invariance or the absence of overlapping production grants. Local acceptance does not require deployment, provider activation, billing, or migration of real data.

Document IDs also have a [1,500-byte UTF-8 limit](https://firebase.google.com/docs/firestore/quotas). Base64url expands raw entity IDs: 1,125 ASCII bytes fit exactly, while 1,126 become 1,502. The port rejects the oversized encoded path with `invalid-path` and its exact relative path. The original ID and local payload remain available; the 900 KiB payload guard alone does not establish path validity. Observed integrated evidence and limits are recorded in [the verification report](../docs/dev/OFFLINE_FIRESTORE_VERIFICATION.md).
