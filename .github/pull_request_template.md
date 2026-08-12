## Summary

Describe the writing-workflow problem and the focused change that solves it.

## Related issue

Link an issue when one exists, or explain why this small change does not need one.

## Verification

List exact commands and manual checks performed. Do not write “all tests pass” without the command and result.

```text
ruff check .
ruff format --check .
pytest
```

## Safety and privacy

- [ ] I used synthetic prose and removed private manuscripts, personal paths, endpoints, and credentials from code, fixtures, screenshots, logs, and commits.
- [ ] I considered filename traversal, request/file limits, stale revisions, atomic writes, and backup behavior where relevant.
- [ ] I did not expose provider credentials or server filesystem paths to the browser.
- [ ] Remote text transmission remains opt-in and clearly disclosed, or this change does not affect it.
- [ ] The default server still binds to `127.0.0.1`, or this change does not affect networking.

## Documentation and compatibility

- [ ] I added or updated tests for behavior changes.
- [ ] I updated both READMEs and relevant docs for user-visible commands, configuration, or API changes.
- [ ] I added a concise entry under `CHANGELOG.md` → `Unreleased` when appropriate.
- [ ] I kept the change within the Writing Workbench's documented project scope.

## Screenshots

For visible interface changes, attach sanitized before/after images using only fictional sample text. Otherwise write “Not applicable.”
