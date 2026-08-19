# Privacy

Writing Workbench is local-first, but “local” is a deployment choice, not a promise that every optional feature stays on the device. This document explains the intended data flows so writers can make an informed choice.

## At a glance

- Opening, editing, searching, and saving chapters use the configured local Flask service and manuscript directory.
- The default `hermes` provider invokes the configured local Hermes profile.
- The `mock` provider is deterministic and does not contact an AI service.
- The `off` provider disables AI requests entirely.
- Writing Workbench does not accept or store an AI API key.
- Writing Workbench includes no account system, analytics, advertising, telemetry, or deliberate tracking request.

## Data stored on disk

The application stores user-created `.md` and `.txt` chapters under the configured manuscript root. Before replacing or deleting an existing chapter, it creates a backup and rotates backups according to the configured retention limit. First startup may create a clearly fictional example manuscript.

Files remain present until the user deletes them. Rotated backups are removed automatically when their per-chapter limit is exceeded. Filesystem snapshots, cloud-sync tools, container volumes, operating-system backups, indexing services, and disk recovery may retain additional copies outside the application's control.

## Data stored in the browser

The interface keeps two origin-scoped collections in browser `localStorage`:

- up to 60 operation-history records, covering actions such as opening, creating, saving, deleting, rewriting, replacing, undoing, and asking questions; records may include chapter titles and short excerpts of rewrite text or Q&A content;
- up to 30 individual Q&A messages in total, including user questions, assistant answers or error messages, provider labels, and display times. Each stored message body is truncated to at most 4,000 characters.

These collections persist until the user clears them or the browser evicts the origin's data. Anyone with access to the browser profile may be able to inspect them. They are navigation and continuity aids, not a durable manuscript backup: the application does not store the current unsaved editor buffer in `localStorage`.

The History panel's **Clear** action clears both operation history and Q&A messages after confirmation and does not delete manuscript or backup files. Browser site-data controls for the application's origin clear them as well. Changing the host or port creates a different browser origin with separate storage.

## Local Hermes data flow

When `WRITING_WORKBENCH_AI_PROVIDER=hermes`, an explicit AI action passes the following to the configured local profile:

- text selected for rewriting;
- rewrite instructions;
- a question;
- nearby or manuscript context included in the request;
- up to the 20 most recent locally stored question-and-answer messages included for continuity;
- bounded copies of all saved chapters when whole-manuscript analysis is requested.

Simply opening, searching, editing, or saving a chapter does not invoke Hermes. A rewrite preview does not save a chapter; replacement first changes the browser buffer, and the user still chooses when to save. Whole-manuscript analysis reads saved disk versions only and excludes unsaved editor changes.

Hermes may use whichever inference backend the selected profile is configured to use. That backend's logging and retention terms remain outside Writing Workbench's control. The workbench does not inspect, copy, or expose the profile's credentials. Review the profile before using it with sensitive manuscripts.

## Local-agent configuration

The Hermes executable and profile name are selected by the server environment. The application must not:

- include a profile path, credential, prompt, or raw process error in generated HTML or JSON responses;
- write Hermes credentials to the manuscript directory, backups, browser storage, or project settings;
- accept an executable path or profile override from an ordinary browser AI request.

Environment managers, shell history, container configuration, crash collectors, and process inspection are outside the application and must be secured by the operator. A real `.env` must remain untracked.

## Logs

Normal server logs should record operational metadata, not chapter bodies, selected text, questions, local-agent prompts, or raw agent output. Debug mode can expose more detail and is intended only for local development with synthetic content.

## Network exposure

The service binds to `127.0.0.1` by default. Changing the bind address can expose manuscript operations to other devices, and the application does not provide built-in multi-user authentication. Do not publish it to an untrusted network without a reviewed authentication, authorization, TLS, CSRF, and rate-limiting layer.

## Third-party delivery layers

Installing packages may contact Python package repositories. Pulling or building containers may contact image registries. Those developer and operator actions are distinct from running the core editor and are governed by the services involved.

## Your controls

- Choose the manuscript directory and protect it with appropriate filesystem permissions and backups.
- Keep the loopback bind address for local use.
- Select `off` to prohibit AI calls or `mock` for network-free demonstrations.
- Before local-agent use, inspect the configured Hermes profile and understand its inference backend.
- Use the History panel's **Clear** action to remove both operation records and Q&A messages, or clear browser site data for the application's origin, especially when using a shared browser profile.
- Remove manuscript and backup directories explicitly when decommissioning an installation.

## Privacy reports

Report an unintended disclosure through the private process in [SECURITY.md](SECURITY.md). Use synthetic text in the initial report and wait for a secure channel before sharing sensitive evidence.
