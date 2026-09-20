# Local AnkiConnect capability audit

Recorded: 2026-09-20.

## Probe

The read-only probe is `scripts/probe-ankiconnect.mjs`. It sends only `version`, `apiReflect`, `deckNames`, `modelNames` and `getActiveProfile`; it never creates, updates, deletes, syncs or changes profile.

Command:

```text
node scripts/probe-ankiconnect.mjs
```

Endpoint: `http://127.0.0.1:8765`.

Observed result:

```json
{
  "readOnly": true,
  "actions": {
    "version": {
      "transportError": "fetch failed"
    }
  }
}
```

A direct three-second HTTP probe also failed to connect to `127.0.0.1:8765`. Anki was not found in the standard installation locations. Therefore no local AnkiConnect version, profile, deck/model list, reflection result or response shape has been verified. This is **unavailable/unverified**, not a protocol failure and not a passed A01.

## Required production protocol surface

The implementation will request AnkiConnect protocol version 6 and isolate all calls behind the sole `anki-client` implementation. These actions remain required:

| Action | Purpose | T00 status |
|---|---|---|
| `version` | handshake | unavailable: connection refused |
| `apiReflect` | optional action discovery | not run because handshake failed |
| `deckNames` | setup deck selection | not run |
| `modelNames` | setup model discovery | not run |
| `modelFieldNames` | exact field-order compatibility | not run |
| `createModel` | explicit one-time model creation | not run; write action |
| `findNotes` | lookup by validated CaptureId | not run |
| `notesInfo` | identity/read-back verification | not run |
| `addNote` | create after persisted pending write | not run; write action |
| `updateNoteFields` | update only managed dirty fields | not run; write action |
| `storeMediaFile` | upload validated audio bytes | not run; write action |
| `guiBrowse` | optional explicit open action | not run |
| `getActiveProfile` | profile mismatch guard when supported | not run |

The client must accept successful `null`, `false` and empty-array results where the action permits them; reject HTTP errors, invalid JSON, missing protocol fields and non-null `error`; and must never automatically retry a write whose remote result is unknown.

## Endpoint and credentials

Production defaults to `http://127.0.0.1:8765`. Only exact loopback hosts (`127.0.0.1`, `localhost`, `::1`) over HTTP/HTTPS are allowed. User-info credentials, remote hosts and redirects are rejected. An optional AnkiConnect key remains background-only and must not appear in content messages, public settings, logs or backups.

## Profile protection

`getActiveProfile` support is unverified. If available, setup records the expected profile and every write verifies it. If unavailable, setup must explicitly state the limitation and require single-profile confirmation; production must not call `loadProfile`.

## Deferred real-environment evidence

A01 remains pending until Anki with AnkiConnect is running. T20 must repeat the probe and then execute side-effecting acceptance only against a dedicated test deck/model and test records. It must verify exact response shapes, creation/read-back/update/media behavior, card scheduling preservation, external edits/deletion and unknown-result recovery. Production and tests must not call `sync`, modify review scheduling, delete unrelated notes/decks, or clear media.
