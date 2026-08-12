# Security policy

Writing Workbench handles unpublished text and optional remote AI credentials. Please report vulnerabilities privately and avoid including real manuscripts or secrets in any report.

## Supported versions

Before the first tagged release, security fixes are applied to the current default branch only. After releases begin, this table will identify maintained release lines rather than implying support that has not been established.

| Version | Supported |
| --- | --- |
| Current default branch | Yes |
| Untagged snapshots and forks | No commitment |

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** private-reporting feature for this repository. Before the repository is made public, the maintainer must enable private vulnerability reporting. If the feature is not available, use the private security contact published in the repository description or release notes at that time.

Do not open a public issue for a suspected vulnerability. Do not send exploit details, credentials, or private manuscripts to a general discussion. If no private channel is yet available, withhold sensitive details until the maintainer publishes one.

Include only what is needed to reproduce and assess the report:

- affected commit or version;
- operating system and Python/browser versions;
- a concise impact statement;
- minimal reproduction using synthetic text and placeholder credentials;
- whether a remote provider or non-default bind address is involved;
- any suggested remediation or disclosure constraints.

The project currently makes no guaranteed response-time SLA. Maintainers will make a reasonable effort to acknowledge, investigate, coordinate a fix, and credit reporters who want attribution. Please allow a fix to be prepared before public disclosure.

## Particularly relevant reports

- path traversal, symlink escape, unsafe filename handling, or arbitrary file access;
- stale revision bypass, missing backup, partial write, or destructive save behavior;
- request-size limit bypass or resource exhaustion with a practical impact;
- provider keys, absolute paths, manuscript content, or stack traces disclosed to the browser or logs;
- unintended remote requests in `mock` or `off` mode;
- remote-provider requests containing text the user did not explicitly submit;
- cross-origin behavior that creates a practical attack against the loopback service;
- dependency vulnerabilities exploitable in the supported configuration.

## Security model and limitations

The default application is a single-user development service bound to `127.0.0.1`. It does not include authentication or claim safe direct exposure to public or untrusted networks. Reports whose only premise is deliberately publishing the development server without the controls warned about in the README may be treated as deployment hardening requests, but concrete bypasses or unexpected exposure are still welcome.

AI output quality, fictional content, and general provider policy disagreements are not security vulnerabilities. Privacy failures, secret leakage, prompt-driven unauthorized actions, and provider-boundary violations are in scope.

## Secret response

If a credential is accidentally committed, removing it from the latest tree is not enough. Revoke or rotate it immediately, then clean the repository history and affected artifacts. Treat any published credential as compromised even if it was exposed briefly.
