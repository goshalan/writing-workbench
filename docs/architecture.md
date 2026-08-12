# Architecture

## Goals

Writing Workbench is a single-user, local-first book drafting application. Its architecture favors a small dependency surface, understandable failure modes, inspectable files, and preservation of the writer's work.

The design goals are:

1. Keep ordinary chapter editing usable without a network connection or AI account.
2. Store manuscripts in open, user-controlled `.md` and `.txt` files.
3. Prevent accidental writes outside the configured manuscript directory.
4. Detect stale saves instead of silently overwriting concurrent changes.
5. Make remote text disclosure explicit and optional.
6. Remain small enough for new contributors to understand end to end.

## System context

```text
┌──────────────────────────────────────┐
│ Browser                              │
│ native HTML + CSS + JavaScript       │
│ editor state, undo, local history    │
└───────────────────┬──────────────────┘
                    │ JSON / HTTP
                    │ default: loopback only
┌───────────────────▼──────────────────┐
│ Flask application                   │
│ routing, validation, error mapping  │
├───────────────────┬──────────────────┤
│ Chapter store     │ AI provider      │
│ hashes/backups    │ interface        │
└─────────┬─────────┴───────┬──────────┘
          │                 │ only on an explicit AI action
┌─────────▼─────────┐  ┌────▼────────────────────┐
│ Manuscript root  │  │ mock / off /            │
│ chapters/backups │  │ configured remote API   │
└───────────────────┘  └─────────────────────────┘
```

## Components

### Browser client

The client renders the three-column workspace, fetches chapter metadata, holds the current edit buffer, and marks it dirty whenever it diverges from the last successful load or save. It provides:

- search and sorting controls;
- chapter selection and creation;
- word and character counts;
- keyboard shortcuts for saving and editor actions;
- a `beforeunload` warning while changes are unsaved;
- AI rewrite preview, replace, and one-step undo;
- local recent-chapter history using browser local storage.

Local history is a navigation convenience, not a manuscript backup. The server remains the source of truth for saved text.

### Flask HTTP layer

The HTTP layer parses JSON, applies the configured request-size limit, validates required fields, calls a domain service, and maps expected failures to stable JSON errors. It does not expose provider credentials or absolute server paths.

Unexpected failures should be logged server-side with a request identifier when available. Client responses should remain useful without revealing stack traces, secrets, or filesystem layout.

### Chapter store

The chapter store is the only component allowed to resolve and mutate manuscript paths. It:

- accepts only a single filename component with a supported extension;
- rejects absolute paths, separators, dot segments, control characters, and reserved backup names;
- verifies resolved paths remain direct children of the configured manuscript root;
- reads and writes UTF-8 text;
- computes lowercase hexadecimal SHA-256 revisions from the exact saved bytes;
- compares the supplied expected revision with the current revision before saving;
- copies the existing version to the backup area before replacement;
- writes new content to a temporary file in the target directory, flushes it, and atomically replaces the target;
- removes the oldest excess backups only after the new pre-write backup is durable.

Keeping the temporary file on the same filesystem as the target makes the final rename atomic on supported local filesystems.

### AI provider interface

The editing application talks to a narrow provider interface rather than a provider-specific SDK. Supported modes are:

- `mock`: deterministic local responses for demos and tests; no network traffic;
- `off`: explicit refusal of AI operations while all writing features remain available;
- `openai-compatible`: opt-in remote calls using a base URL, API key, and model read from the server environment.

Provider selection is fixed at process startup. A browser request cannot change the base URL, model, or key. Remote calls should use bounded timeouts and convert upstream failures into structured `502` or `503` responses without returning credentials or raw upstream bodies.

## Data layout

The configured manuscript root contains user-visible `.md` and `.txt` chapters. Backups live in an application-managed subdirectory and are excluded from chapter listings.

A representative layout is:

```text
manuscript/
├── 01-arrival.md
├── 02-the-letter.md
└── .backups/
    └── 01-arrival.md/
        ├── 20260812T011500000000Z-<revision>.bak
        └── 20260812T012100000000Z-<revision>.bak
```

Backup names are implementation details. Consumers should not parse them, and user-supplied paths must never select a backup destination.

## Save protocol and concurrency

```text
Client reads chapter ──► content + revision R1
Client edits locally
Client saves content + expected revision R1
                         │
             current revision still R1?
                    ┌────┴────┐
                  yes         no
                   │           │
        backup + atomic write  409 conflict + current revision
                   │
             content + revision R2
```

The revision is an optimistic concurrency token, not authentication. Two tabs can read `R1`; the first successful save produces `R2`, and the second receives `409`. A missing or mismatched expected revision must not silently become a last-write-wins save.

For new chapters, creation is exclusive: an existing target produces `409`. A successful create does not need a pre-existing revision.

## Trust boundaries

### Browser to local server

Even though the default connection is loopback, every request is treated as untrusted input. Filename, JSON type, field length, allowed enum, and total request size checks happen on the server.

This project does not claim to be a secure multi-user service. Loopback binding reduces exposure but does not replace authentication or browser-origin protections for hostile local environments.

### Server to filesystem

The manuscript root is configured by the process owner. API clients can choose only validated child filenames, never a root or arbitrary path. Symlink handling must preserve that invariant; implementations should reject a target whose resolved path escapes the root.

### Server to remote provider

The remote AI provider is outside the application's privacy boundary. Only an explicit rewrite or question request can cross this boundary. The selected text, instruction or question, and any submitted context may leave the device. Provider credentials flow from the server environment to the upstream authorization header and nowhere else.

## Error model

All API errors use an object with a stable machine-readable code and a human-readable message:

```json
{
  "ok": false,
  "error": {
    "code": "chapter_conflict",
    "message": "The chapter changed after it was loaded.",
    "details": {
      "current_sha256": "<64 lowercase hexadecimal characters>"
    }
  }
}
```

`details` is optional. It must contain only values safe to disclose to the browser. HTTP status codes retain their normal meaning; clients should branch on both the status and `error.code`.

## Deployment model

The supported default is a single process bound to `127.0.0.1`. Docker Compose preserves loopback-only host publication. Production or shared deployment is outside the initial security model and requires, at minimum, a production WSGI server, authentication and authorization, TLS, CSRF controls, rate limiting, durable volume and backup management, and an operator review of remote-provider disclosure.

## Testing strategy

The main regression suite exercises the service through its public Flask test client and temporary manuscript directories. It covers:

- valid CRUD and listing behavior;
- filename and path traversal rejection, including encoded input;
- deterministic revisions and stale-save conflicts;
- backup creation and rotation;
- atomic-save failure behavior where practical;
- request body limits and structured errors;
- disabled and mock provider behavior;
- absence of provider credentials in responses.

CI runs Ruff lint and formatting checks plus pytest on supported Python versions. A secret scan provides an additional publication guard; it does not replace careful review of fixtures, screenshots, commit history, and generated artifacts.

## Deliberate constraints

- No database: open text files are the durable manuscript format.
- No autosave: manual save plus a visible dirty state keeps persistence intentional.
- No multi-user collaboration: optimistic concurrency protects against stale tabs and external editors, not unauthorized users.
- No mandatory AI: offline editing is a complete product path.
- No arbitrary plugin execution: provider adapters are maintained code, not uploaded scripts.
