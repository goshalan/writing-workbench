# HTTP API

Writing Workbench exposes a small JSON API under `/api`. Examples assume the default local address:

```text
http://127.0.0.1:8787
```

This document describes the initial API. It is not yet versioned; incompatible changes must be called out in `CHANGELOG.md` before a stable release.

## Conventions

- Request and response bodies use UTF-8 JSON unless stated otherwise.
- Chapter names are URL-encoded as one path segment and must end in `.md` or `.txt`.
- Timestamps, when returned, use ISO 8601 in UTC.
- Revisions are lowercase, 64-character SHA-256 hex digests of the exact saved UTF-8 bytes.
- Unknown JSON fields may be ignored. Missing required fields and wrong field types return `400`.
- Requests larger than the configured maximum return `413`.

## Errors

Every expected API failure has this shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_filename",
    "message": "Filename must be a single .md or .txt path component.",
    "details": {}
  }
}
```

`details` may be omitted. It never includes an API key, absolute manuscript path, stack trace, or raw remote-provider response.

Common statuses:

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON, invalid field, or unsafe filename |
| `404` | Chapter or route not found |
| `409` | Chapter already exists or supplied revision is stale |
| `413` | Request body exceeds the configured limit |
| `415` | Request body is not JSON |
| `422` | Request is well-formed but cannot be processed |
| `428` | An update or delete omitted its expected revision |
| `502` | Configured remote provider failed |
| `503` | AI is disabled or required provider configuration is unavailable |

## Health

### `GET /api/health`

Returns process readiness and a chapter count without returning manuscript contents or exposing configuration secrets.

```bash
curl --fail http://127.0.0.1:8787/api/health
```

```json
{
  "ok": true,
  "status": "healthy",
  "version": "0.1.0",
  "provider": "mock",
  "chapter_count": 2
}
```

The provider name is safe capability information. Provider URLs, models, keys, and filesystem paths are not returned.

## Chapters

### `GET /api/chapters`

Lists chapter metadata. Optional query parameters:

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `q` | text | empty | Case-insensitive filename search (`search` is accepted as an alias) |
| `sort` | `name`, `modified`, `size`, `words` | `name` | Sort key |
| `order` | `asc`, `desc` | `asc` | Sort direction |

```bash
curl 'http://127.0.0.1:8787/api/chapters?q=arrival&sort=modified&order=desc'
```

```json
{
  "ok": true,
  "chapters": [
    {
      "filename": "01-arrival.md",
      "name": "01-arrival.md",
      "title": "01-arrival",
      "extension": ".md",
      "modified_at": "2026-08-12T01:15:00+00:00",
      "size_bytes": 2480,
      "word_count": 412,
      "character_count": 2388,
      "chapter_number": 1,
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ],
  "count": 1
}
```

### `POST /api/chapters`

Creates a new chapter. Creation is exclusive and returns `409 chapter_exists` if the filename already exists.

`filename` may also be supplied as `name`. Alternatively, send `title` plus an optional `extension` (`md` or `txt`); the server generates and validates a safe filename, defaulting to Markdown.

```bash
curl -X POST http://127.0.0.1:8787/api/chapters \
  -H 'Content-Type: application/json' \
  --data '{"filename":"03-the-garden.md","content":"# The Garden\n\n"}'
```

Request:

```json
{
  "filename": "03-the-garden.md",
  "content": "# The Garden\n\n"
}
```

Successful response: `201 Created`.

```json
{
  "ok": true,
  "created": true,
  "chapter": {
    "filename": "03-the-garden.md",
    "name": "03-the-garden.md",
    "title": "03-the-garden",
    "extension": ".md",
    "size_bytes": 14,
    "word_count": 2,
    "character_count": 14,
    "sha256": "<64 lowercase hexadecimal characters>",
    "modified_at": "2026-08-12T01:20:00+00:00",
    "chapter_number": 3
  },
  "content": "# The Garden\n\n"
}
```

### `GET /api/chapters/<filename>`

Reads one chapter and its current revision.

```bash
curl http://127.0.0.1:8787/api/chapters/03-the-garden.md
```

```json
{
  "ok": true,
  "chapter": {
    "filename": "03-the-garden.md",
    "name": "03-the-garden.md",
    "title": "03-the-garden",
    "extension": ".md",
    "size_bytes": 14,
    "word_count": 2,
    "character_count": 14,
    "sha256": "<64 lowercase hexadecimal characters>",
    "modified_at": "2026-08-12T01:20:00+00:00",
    "chapter_number": 3
  },
  "content": "# The Garden\n\n"
}
```

### `PUT /api/chapters/<filename>`

Saves an existing chapter using optimistic concurrency. `expected_sha256` must equal the current revision returned by the most recent read or save.

```bash
curl -X PUT http://127.0.0.1:8787/api/chapters/03-the-garden.md \
  -H 'Content-Type: application/json' \
  --data '{"content":"# The Garden\n\nRain silvered the leaves.\n","expected_sha256":"CURRENT_64_CHARACTER_SHA256"}'
```

Request:

```json
{
  "content": "# The Garden\n\nRain silvered the leaves.\n",
  "expected_sha256": "<64 lowercase hexadecimal characters>"
}
```

The expected revision may instead be supplied in an `If-Match` header. Success returns `200` with `ok`, `saved`, updated `chapter` metadata, `content`, and `backup`. Before replacement, the server stores the previous bytes as a rotating backup.

```json
{
  "ok": true,
  "saved": true,
  "chapter": {
    "filename": "03-the-garden.md",
    "sha256": "<new 64-character lowercase hexadecimal revision>"
  },
  "content": "# The Garden\n\nRain silvered the leaves.\n",
  "backup": ".backups/03-the-garden.md/<generated backup name>.bak"
}
```

The real `chapter` object contains all metadata fields shown in the read response. `backup` is a manuscript-root-relative record, never an absolute server path.

If another tab or external editor changed the file, the response is `409 Conflict` and no write occurs:

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

The client should retain its unsaved buffer, offer to reload the current file, or let the user reconcile both versions. It must not automatically retry with the new revision.

### `DELETE /api/chapters/<filename>`

Deletes an existing chapter only when `expected_sha256` (or `If-Match`) matches its current revision. The previous content is backed up first.

```bash
curl -X DELETE http://127.0.0.1:8787/api/chapters/03-the-garden.md \
  -H 'Content-Type: application/json' \
  --data '{"expected_sha256":"CURRENT_64_CHARACTER_SHA256"}'
```

Success returns `ok`, `deleted`, the deleted chapter metadata, and backup information. A stale revision returns the same `409 chapter_conflict` shape as `PUT`.

## AI assistance

AI routes never receive or return provider credentials. In `mock` mode they are deterministic and local. In `off` mode they return `503 ai_provider_disabled`. In `openai-compatible` mode, supplied text and context are transmitted to the configured remote provider.

### `POST /api/ai/rewrite`

Requests a rewrite preview. This route does not save or mutate a chapter.

`selection` and `selected_text` are accepted as aliases for `text`.

```json
{
  "text": "Rain fell on the garden.",
  "instruction": "Make the sentence more vivid without changing its meaning.",
  "context": "Optional nearby manuscript text"
}
```

```json
{
  "ok": true,
  "provider": "mock",
  "preview": true,
  "saved": false,
  "result": "Rain stippled the dark garden leaves.",
  "rewritten_text": "Rain stippled the dark garden leaves."
}
```

The browser owns replace and undo behavior. A replacement changes only the in-memory editor buffer until the user saves the chapter.

### `POST /api/ai/ask`

Answers a question using only the context supplied with the request plus the configured provider's behavior. This route does not automatically read every chapter.

`message` is accepted as an alias for `question`. Invalid history entries are ignored; at most the most recent 20 valid `user` or `assistant` entries are considered.

```json
{
  "question": "Which promise has the narrator not yet fulfilled?",
  "context": "The caller-selected manuscript context",
  "history": [
    {"role": "user", "content": "What promise was made?"},
    {"role": "assistant", "content": "A map was promised back."}
  ]
}
```

```json
{
  "ok": true,
  "provider": "mock",
  "answer": "The supplied context says the narrator has not returned the borrowed map.",
  "reply": "The supplied context says the narrator has not returned the borrowed map."
}
```

Clients should display which provider mode handled the response and should remind users that remote mode transmits the submitted fields outside the local application.

## Filename rules

A valid filename is one non-empty filename component ending in `.md` or `.txt`. Examples:

| Input | Result |
| --- | --- |
| `01-arrival.md` | accepted |
| `notes.txt` | accepted |
| `../secret.md` | rejected |
| `folder/chapter.md` | rejected |
| `/tmp/chapter.md` | rejected |
| `chapter.html` | rejected |
| `.backups` | rejected |

Both raw and URL-decoded input are validated. Clients must not rely on browser-side validation for security.

## Request limits

The maximum applies to the whole HTTP request body, not only the chapter text. A request exceeding the limit receives a structured `413` response:

```json
{
  "ok": false,
  "error": {
    "code": "request_too_large",
    "message": "The request body exceeds the configured limit."
  }
}
```
