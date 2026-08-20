# Writing Workbench

[简体中文](README.zh-CN.md)

Writing Workbench is a small, local-first workspace for drafting books in Markdown and plain text. It combines chapter navigation, a distraction-conscious editor, revision helpers, and explicit save safety in one self-hosted Flask application.

The core writing workflow works offline. AI features are optional and use a local Hermes agent by default; a deterministic mock provider remains available for network-free demonstrations. Writing Workbench itself needs no API key.

> Screenshot placeholder: before the first public release, capture the three-column workspace with only the bundled fictional example manuscript visible. Remove browser bookmarks, local paths, notifications, account details, and provider credentials from the frame, then add the image under `docs/images/` and link it here.

## Project scope

This repository contains one product only: a writing workbench. Every feature is expected to support drafting or maintaining a book manuscript.

## Features

- Browse, search, and sort `.md` and `.txt` chapters.
- Create, read, edit, and manually save local chapters.
- Configure the manuscript directory with an environment variable or CLI option.
- Start immediately with a fictional, neutral example manuscript created on first run.
- Reject unsafe filenames and directory traversal attempts.
- Detect concurrent edits with SHA-256 revisions and return HTTP `409` instead of silently overwriting newer work.
- Write atomically, create a backup before replacement, and rotate old backups.
- Show character and word counts, warn about unsaved work, and support keyboard shortcuts.
- Preview, replace, and undo AI-assisted rewrites.
- Ask questions about supplied manuscript context.
- Analyze all saved chapters for character relationships, foreshadowing, continuity risks, and next-chapter suggestions.
- Choose English or Simplified Chinese automatically from the browser and operating-system language preference.
- Keep up to 60 operation-history entries and 30 question-and-answer messages in this browser's `localStorage`, with an in-app clear action.
- Expose a health endpoint and consistent structured errors.

## Quick start

Requirements: Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
python -m writing_workbench
```

Open <http://127.0.0.1:8787>. The default manuscript directory is created automatically if it does not exist. To use another directory, set it directly in the environment:

```bash
WRITING_WORKBENCH_DIR="$PWD/my-manuscript" python -m writing_workbench
```

Run with an explicit CLI directory:

```bash
python -m writing_workbench --manuscripts-dir "$PWD/my-manuscript" --host 127.0.0.1 --port 8787
```

CLI options take precedence over matching environment variables. Run `python -m writing_workbench --help` for the authoritative option list.

### Tests and lint

```bash
ruff check .
ruff format --check .
pytest
```

### Docker Compose

```bash
docker compose up --build
```

The Compose configuration publishes the service at <http://127.0.0.1:8000> and stores manuscripts in a local named volume by default. Review the mount and backup strategy before using it for important work.

## Configuration

The application reads configuration at startup. Secrets must be supplied through the process environment; they are never accepted from the browser or written to project configuration.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WRITING_WORKBENCH_DIR` | `./manuscripts` | Directory containing `.md` and `.txt` chapters |
| `WRITING_WORKBENCH_HOST` | `127.0.0.1` | Listen address; keep loopback unless you have added appropriate access controls |
| `WRITING_WORKBENCH_PORT` | `8787` | HTTP port |
| `WRITING_WORKBENCH_MAX_REQUEST_BYTES` | `2097152` | Maximum request size in bytes |
| `WRITING_WORKBENCH_MAX_FILE_BYTES` | `1900000` | Maximum chapter size in bytes |
| `WRITING_WORKBENCH_BACKUP_LIMIT` | `10` | Maximum retained backups per chapter |
| `WRITING_WORKBENCH_CREATE_EXAMPLES` | `true` | Create two neutral sample chapters when the manuscript directory is empty |
| `WRITING_WORKBENCH_BOOK_TITLE` | inferred from the directory | Display name for the current manuscript |
| `WRITING_WORKBENCH_TARGET_WORDS` | `80000` | Target used by host dashboards when displaying manuscript progress |
| `WRITING_WORKBENCH_SUITE_HOME_URL` | empty | Optional back link when mounted inside another local dashboard |
| `WRITING_WORKBENCH_SUITE_HOME_LABEL` | `Back to local tools` | Accessible label for the optional dashboard back link |
| `WRITING_WORKBENCH_SUITE_MARK` | `WW` | Short mark shown inside the optional dashboard back link |
| `WRITING_WORKBENCH_AI_PROVIDER` | `hermes` | `hermes`, `mock`, or `off` |
| `WRITING_WORKBENCH_HERMES_COMMAND` | discovered from `PATH` | Local Hermes executable |
| `WRITING_WORKBENCH_HERMES_PROFILE` | empty | Optional isolated local Hermes profile; empty uses Hermes' current default |
| `WRITING_WORKBENCH_AI_TIMEOUT` | `120` | Local-agent timeout in seconds |
| `WRITING_WORKBENCH_ANALYSIS_CONTEXT_CHARS` | `100000` | Maximum saved-manuscript characters sent to one analysis run |

All application settings use the `WRITING_WORKBENCH_` prefix. The browser cannot change the Hermes executable or profile.

See [.env.example](.env.example) for placeholders. Export the values or configure them in your process manager; the application does not load `.env` files by itself. Do not commit a populated `.env` file.

## Local AI providers

`hermes` invokes the selected local Hermes profile as a subprocess. `mock` is deterministic and performs no network request. `off` disables AI requests. The Hermes invocation is restricted to a non-mutating toolset, ignores workspace rules, and is instructed to treat manuscript text as untrusted content.

An AI action passes only the necessary text to the local Hermes process: the selected passage and nearby context for rewriting, the current chapter and recent conversation for Q&A, or bounded copies of all saved chapters for whole-manuscript analysis. Opening, editing, or saving never invokes Hermes. Unsaved editor changes are excluded from whole-manuscript analysis.

## Security and privacy model

Writing Workbench is designed for a single trusted user on a trusted machine:

- The development server binds to loopback by default and includes no multi-user authentication.
- Only simple `.md` and `.txt` filenames inside the configured manuscript root are accepted.
- Request size is capped before JSON processing.
- Saves require the last-seen SHA-256 revision, use a temporary file plus atomic replacement, and back up the previous version.
- Manuscript text stays in the local application/Hermes boundary; only explicit AI actions invoke the local agent.
- Browser `localStorage` retains up to 60 operation records and 30 question-and-answer messages for the current origin. Operation records can include chapter titles and short rewrite or Q&A excerpts; each stored Q&A message is limited to 4,000 characters. These records persist until cleared or evicted by the browser. The History panel's **Clear** action removes both collections without deleting manuscript files; browser site-data controls can clear them as well. The unsaved editor buffer is not stored there as a manuscript backup.

Do not expose the development server directly to a public or untrusted network. For a shared deployment, add authentication, TLS, CSRF protection, a production WSGI server, rate limits, and an explicit authorization model. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Architecture

The repository intentionally keeps the stack compact:

```text
Browser (native HTML/CSS/JS)
        │ JSON over loopback HTTP
Flask routes and structured errors
        ├── safe chapter store ── manuscript files + rotating backups
        └── provider interface ── local Hermes / mock / off
```

The chapter store owns filename validation, revision calculation, backup rotation, and atomic writes. Provider adapters share a small interface so that editing remains independent from any AI service. Details and trust boundaries are documented in [docs/architecture.md](docs/architecture.md).

## API

The JSON API includes:

- `GET /api/health`
- `GET, POST /api/chapters`
- `GET, PUT, DELETE /api/chapters/<filename>`
- `POST /api/ai/rewrite`
- `POST /api/ai/ask`
- `POST /api/ai/analyze`

A save carries the revision returned by the preceding read. If the file changed in the meantime, the server returns `409 conflict` with the current revision so the client can reload or reconcile deliberately. See [docs/api.md](docs/api.md) for request and response examples.

## Roadmap

- Accessible keyboard and screen-reader review across supported browsers.
- User-controlled chapter ordering and manuscript metadata.
- Backup browsing and restoration in the interface.
- Export to a small set of open, documented formats.
- Pluggable local inference adapters with clear capability detection.
- Contributor-maintained translations beyond English and Simplified Chinese.

Roadmap items are proposals, not promises or completed features. Please open a feature request before investing in a large change.

## Contributing

Bug reports, focused enhancements, tests, documentation, and accessibility improvements are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [Code of Conduct](CODE_OF_CONDUCT.md), and avoid including real manuscripts or credentials in issues, fixtures, screenshots, and logs.

Security reports should follow [SECURITY.md](SECURITY.md) rather than a public issue.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Copyright 2026 Alan.
