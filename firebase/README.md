# Isolated OpenGym Firestore emulator rules

`emulator.json` loads `opengym.rules` only for local Auth (127.0.0.1:9099) and Firestore (127.0.0.1:8081), using the explicit project `demo-opengym`. Run from the repository root with the official Firebase CLI and Java 21:

```sh
firebase emulators:exec --project demo-opengym --config firebase/emulator.json --only auth,firestore "npm --prefix frontend run test:firestore"
```

The script refuses other project IDs or emulator addresses before initializing the SDK. It creates disposable Auth users and data, verifies the official Node SDK transport with its scoped gRPC override, and terminates/deletes every SDK client. Expected permission and size failures produce SDK error diagnostics. Emulator contention behavior does not certify production transaction contention.

This is an **emulator protection fragment**, not the deployed production rules. Reconcile it with the actual production rules before any activation. Firestore `allow` expressions combine permissively: a broader production match could override these restrictions. No deployment, legacy migration, billing change, or production activation is part of this configuration.

Only the owner may access `users/{uid}/apps/opengym` and the listed domain subcollections. Control and record envelopes, payload shapes, generation, unit version, and atomic revision advancement are checked. Jobs and physical cleanup remain denied until their separately reviewed protocol is implemented. Legacy collections are denied in this isolated emulator ruleset; that makes no claim about their unknown deployed rules.

Every active-generation record returned by a profile query is validated. A record missing `generation`, using the wrong generation type, or belonging to another generation is outside that query's view; this is not a corruption inventory of all stored data. An existing control remains initialized even when that view is empty. A directly affected record is validated before a transaction writes; valid older records may be replaced after a reset, while future-generation records are rejected.

The adapter rejects a serialized document above 900 KiB with its relative path and leaves the pending local payload recoverable. Firestore rules cannot measure a map's serialized byte length; the actual emulator backend separately tests the Firestore 1 MiB rejection. The SDK also enforces Firestore encoding constraints. No data is truncated to pass either limit.
