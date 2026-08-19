# Contributing to Writing Workbench

Thank you for helping make local book drafting safer and more pleasant. Contributions should stay within this repository's single purpose: a focused Markdown/TXT writing workbench.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are accepted under the [Apache License 2.0](LICENSE).

## Before opening an issue

- Search existing issues to avoid duplicates.
- Remove real manuscript passages, credentials, account details, private paths, and network information from reproductions.
- Reduce a bug to the bundled fictional example or another synthetic sample.
- For vulnerabilities, do not open an issue; follow [SECURITY.md](SECURITY.md).

Use the bug report for reproducible defects and the feature request for focused proposals. Contributions that do not directly serve the book-writing workflow are outside project scope.

## Development setup

Writing Workbench requires Python 3.11 or newer.

```bash
git clone <your-fork-url>
cd writing-workbench
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

Run against a disposable manuscript directory:

```bash
python -m writing_workbench \
  --manuscripts-dir "$PWD/.dev-manuscripts" \
  --host 127.0.0.1 \
  --port 8787 \
  --debug
```

Never point development or tests at the only copy of an important manuscript.

## Quality checks

Run the same checks as CI before submitting:

```bash
ruff check .
ruff format --check .
pytest
```

If you change behavior, add or update tests. Security-sensitive changes should cover both successful use and adversarial inputs. Important coverage areas include:

- filename validation and URL-decoded traversal attempts;
- request and file-size limits;
- stale SHA-256 revisions and `409` responses;
- backup creation, rotation, and write-failure behavior;
- Hermes, mock, and off provider modes;
- assurance that credentials and absolute paths never enter API responses.

For interface work, also test keyboard-only use, narrow and wide viewports, unsaved-change warnings, rewrite preview/replace/undo, and conflict recovery.

## Change design

Prefer small, reviewable changes. Keep these constraints intact unless a proposal has been discussed and explicitly accepted:

- core editing remains offline-capable;
- `.md` and `.txt` remain the durable manuscript formats;
- default networking remains loopback-only;
- local-agent AI remains optional and clearly disclosed;
- profile paths, prompts, and raw process failures remain server-side;
- chapter writes remain atomic, revision-checked, and backed up;
- the browser receives no arbitrary local path.

New dependencies need a concrete maintenance or security benefit. Prefer Python's standard library and browser-native APIs when they are sufficient.

## Commit and pull-request guidance

- Create a topic branch from the current default branch.
- Use focused commits with imperative summaries, such as `Reject encoded path separators`.
- Do not mix formatting-only changes with behavior changes unless unavoidable.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Update README and API/architecture docs when commands, configuration, or contracts change.
- Complete the pull-request template and report the exact commands you ran.
- Link the issue being fixed, when one exists.

Maintainers may ask for a smaller scope, additional tests, or a design discussion. A pull request is not guaranteed to be merged.

## Fixtures, logs, and screenshots

Use invented names and synthetic prose. Do not submit copyrighted book passages, unpublished manuscripts, personal correspondence, access tokens, credentials, private endpoints, or screenshots containing private browser or desktop state.

When demonstrating a Hermes profile, use synthetic manuscript text and inspect both the working tree and Git history before pushing. Never commit profile credentials or copied auth files.

## Documentation

Keep English and Simplified Chinese top-level READMEs aligned for user-visible features and configuration. Clear, narrow documentation corrections are welcome even without a related code change.

## Developer Certificate of Origin

By contributing, you certify that you have the right to submit the work under this project's license. Add a sign-off to each commit:

```bash
git commit --signoff
```

The sign-off records agreement with the [Developer Certificate of Origin 1.1](https://developercertificate.org/). It is not a transfer of copyright.
