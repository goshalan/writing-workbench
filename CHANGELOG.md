# Changelog

All notable changes to Writing Workbench will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once releases begin.

## [Unreleased]

### Added

- Local-first Flask writing workspace for Markdown and text chapters.
- Chapter listing, search, sorting, creation, reading, editing, deletion, and manual save.
- Safe filename validation and configurable request and file-size limits.
- SHA-256 optimistic concurrency, atomic replacement, pre-save backups, and backup rotation.
- Word and character counts, unsaved-change warnings, keyboard shortcuts, and browser-local recent history.
- AI rewrite preview/replace/undo and manuscript question answering.
- Whole-manuscript AI analysis for character relationships, foreshadowing, continuity risks, and next-chapter suggestions.
- Automatic English and Simplified Chinese UI selection based on browser/operating-system language preferences.
- Local Hermes agent provider, network-free mock provider, and explicit off mode; no API key is required by Writing Workbench.
- Structured JSON errors and a health endpoint.
- English and Simplified Chinese documentation, security and privacy policies, community templates, CI, container configuration, and tests.

### Changed

- Reworked the writing workspace with a responsive liquid-glass visual system and independently usable editor and assistant regions.
- Display the configured book title and meaningful progress metadata through the health endpoint.
- Hide YAML front matter and a duplicate first-level Markdown title from the prose editor while preserving them on save.
- Prefer the latest numbered chapter when the workspace opens and use document headings for friendly chapter titles.

No release has been published yet. Add a real comparison link only after the public repository URL and first tag exist.
