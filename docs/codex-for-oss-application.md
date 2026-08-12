# Codex for Open Source application worksheet

This worksheet is only for Writing Workbench / 写书工具台. It is preparation material, not a submitted application and not evidence that the project has been accepted or qualifies automatically.

The field mapping was checked against the [official Codex for Open Source form](https://openai.com/form/codex-for-oss/) on 2026-08-12. The form says that maintainers of active open-source projects may apply and that review considers usage, ecosystem importance, and evidence of active maintenance. Alan should re-check the live form and program terms immediately before applying because fields and criteria can change.

## Verified 500-character drafts

Character counts below use Python `len()` on the draft text only. They count letters, spaces, and punctuation exactly as displayed, excluding the surrounding Markdown and newline. Each draft is below 500 characters.

### Project description — 416 characters

> Writing Workbench is a lightweight, local-first web app for drafting books in Markdown or plain text. It offers a focused three-column workspace, chapter search and sorting, safe atomic saves with version-conflict detection and rotating backups, plus optional provider-neutral AI rewriting and manuscript Q&A. It runs with Flask and browser-native HTML, CSS, and JavaScript, keeping the core workflow usable offline.

Suggested use: repository description material or the form's optional “Anything else we should know?” field. The current form has no separately labeled project-description field.

### Why this project qualifies — 425 characters

> Writing Workbench is an Apache-2.0 project that solves a real, reusable problem for authors: dependable local manuscript editing without a hosted platform. Its compact Python and browser-native codebase is approachable for contributors, while concurrency checks, backups, privacy boundaries, tests, and documented APIs create meaningful engineering work. AI is optional, provider-neutral, and never required for core writing.

This draft argues ecosystem importance through the problem and maintainability of the project. Before submission, append only real, current adoption or maintenance evidence if room permits. Do not add projected usage as though it already happened.

### API credits intended use — 414 characters

> API credits would support opt-in development and evaluation of provider-neutral rewriting and manuscript Q&A. Credits would be used for maintainer-run integration tests, prompt-quality experiments on synthetic text, documentation examples, and regression checks across supported OpenAI-compatible models. No private manuscripts or contributor data would be sent without explicit, informed configuration and action.

This scope keeps credits tied to core open-source work. It does not promise production traffic, users, or benchmarks.

### Reproduce the counts

Copy the exact draft strings into this command before submission if any wording changes:

```bash
python - <<'PY'
drafts = {
    "Project description": "Writing Workbench is a lightweight, local-first web app for drafting books in Markdown or plain text. It offers a focused three-column workspace, chapter search and sorting, safe atomic saves with version-conflict detection and rotating backups, plus optional provider-neutral AI rewriting and manuscript Q&A. It runs with Flask and browser-native HTML, CSS, and JavaScript, keeping the core workflow usable offline.",
    "Why this project qualifies": "Writing Workbench is an Apache-2.0 project that solves a real, reusable problem for authors: dependable local manuscript editing without a hosted platform. Its compact Python and browser-native codebase is approachable for contributors, while concurrency checks, backups, privacy boundaries, tests, and documented APIs create meaningful engineering work. AI is optional, provider-neutral, and never required for core writing.",
    "API credits intended use": "API credits would support opt-in development and evaluation of provider-neutral rewriting and manuscript Q&A. Credits would be used for maintainer-run integration tests, prompt-quality experiments on synthetic text, documentation examples, and regression checks across supported OpenAI-compatible models. No private manuscripts or contributor data would be sent without explicit, informed configuration and action.",
}
for label, draft in drafts.items():
    print(f"{label}: {len(draft)} characters")
    assert len(draft) <= 500
PY
```

Expected output:

```text
Project description: 416 characters
Why this project qualifies: 425 characters
API credits intended use: 414 characters
```

## Facts that must remain pending

Do not replace these entries with estimates, placeholders that look real, or invented social proof.

| Item | Current status | What to do |
| --- | --- | --- |
| Public GitHub repository URL | **Pending Alan / publication** | Paste the real public repository URL only after the repository exists and is visible to logged-out visitors. |
| GitHub username | **Pending Alan** | Use Alan's real public profile; do not infer it from a local directory or Git config. |
| Stars | **Pending publication and actual observation** | Record the real count and observation date, even if it is zero. |
| Downloads | **Pending a real distribution channel** | Include only a count supplied by an auditable package or release source; otherwise say that no download metric is available. |
| Dependents | **Pending publication and actual observation** | Use GitHub or a package registry only if it exposes a real dependent count. |
| OpenAI Organization ID | **Pending Alan** | Alan must obtain it from his account and enter it directly in the application; never commit it to this public repository. |
| User feedback | **Pending real feedback** | Include only attributable feedback submitted by real users with permission, or accurately state that none is available yet. |
| Usage/adoption narrative | **Pending public operation** | Link to verifiable releases, package data, downstream references, or issues; do not present projections as adoption. |

## Primary or core maintainer evidence

The role selection should describe the applicant's real responsibility at submission time. Repository ownership alone is not a complete maintenance record.

Evidence that can substantiate a **primary maintainer** role includes:

- a sustained commit history in which the applicant authors or merges the central implementation and maintenance changes;
- signed or attributable releases and release notes managed by the applicant;
- issue triage, reproducible bug investigations, labels, milestones, and closure decisions;
- pull-request review, requested changes, merges, and contributor support;
- security-policy ownership and documented handling of responsibly disclosed reports;
- roadmap and compatibility decisions recorded transparently in issues or discussions.

Evidence for a **core maintainer** is similar but should also show that the project recognizes the applicant as part of the group trusted to review, merge, release, or handle security work.

None of those activities should be claimed merely because this worksheet names them. At application time, link to actual commits, releases, issues, pull requests, governance documents, or public maintainer listings. If the repository is newly published and does not yet show active maintenance or meaningful usage, waiting for a genuine public record may produce a more accurate application.

## Public-before-application checklist

- [ ] Confirm the repository contains only Writing Workbench and its documentation.
- [ ] Read every tracked file, fixture, example, log, and screenshot for private manuscript text and personal infrastructure details.
- [ ] Scan the complete Git history, not only the working tree, for credentials and private data.
- [ ] Confirm `.env`, editor state, caches, build outputs, manuscript directories, and backups are ignored and untracked.
- [ ] Verify the Apache-2.0 license and the intended `Copyright 2026 Alan` notice.
- [ ] Install from a clean clone using the README commands on every supported Python version.
- [ ] Run Ruff, pytest, request-limit tests, traversal tests, conflict tests, backup tests, and provider off/mock tests.
- [ ] Start the server from a clean clone and manually verify health, chapter CRUD, stale-save `409`, rewrite preview/replace/undo, question answering, keyboard shortcuts, and unsaved warnings.
- [ ] Verify the default bind address is `127.0.0.1` in direct and Compose startup.
- [ ] Confirm no API key, provider URL, absolute manuscript path, or stack trace is returned to the browser.
- [ ] Use only the neutral bundled example in screenshots; remove account details, bookmarks, paths, and notifications.
- [ ] Enable GitHub private vulnerability reporting or publish another private security contact.
- [ ] Replace all application worksheet pending items with real values where available; leave unavailable metrics explicitly unavailable.
- [ ] Make the GitHub profile and repository public, then verify both while signed out.
- [ ] Re-open the live application form, review current program terms, and re-run character counts after every wording change.
- [ ] Submit only after Alan personally verifies every identity, account, metric, and consent field.

## Application field mapping

| Official form field observed 2026-08-12 | Source in this worksheet | Final action |
| --- | --- | --- |
| First name | Not stored | Alan enters his actual first name. |
| Last name | Not stored | Alan enters his actual last name; do not guess it. |
| ChatGPT account email | Not stored | Alan enters it directly in the form; never add it here. |
| GitHub username | Pending-facts table | Fill only after confirming the public profile. |
| GitHub repository URL | Pending-facts table | Fill only with the published, publicly visible URL. |
| Primary maintainer / Core maintainer | Maintainer-evidence section | Select the role supported by the public record at submission time. |
| Why does this repository qualify? | 425-character draft | Re-check facts and count; add metrics only when real and useful. |
| Interested in Codex Security | No assumed answer | Alan chooses according to actual interest and current program terms. |
| Interested in API credits | API-use draft | Alan chooses; the draft supports this selection but does not submit it. |
| OpenAI Organization ID | Pending-facts table | Retrieve from the account and enter directly; do not commit it. |
| How will you use API credits? | 414-character draft | Re-check intent and count immediately before submission. |
| Anything else we should know? | 416-character project description, if useful | Use only if it adds material information; keep the field within its live limit. |

## Final integrity rule

An accurate modest application is stronger than an impressive-looking unverifiable one. Do not invent or round up metrics, manufacture feedback, create artificial activity, or claim selection. Keep dated evidence for every quantitative statement and disclose when a metric is unavailable.
