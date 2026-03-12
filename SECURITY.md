# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in BurnChat, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email us at: **security@burnchat.io**

Or DM us on Twitter: [@burnchatio](https://x.com/burnchatio)

We will acknowledge your report within 48 hours and work with you to understand and address the issue.

## What Qualifies

- XSS vulnerabilities
- Server-side code execution
- Ways to persist or recover messages after a room is burned
- Authentication bypass on the admin panel
- Rate limiting bypasses
- Any way to extract user data from the server

## What Doesn't Qualify

- Screenshots (we can't prevent these — this is a known limitation)
- Social engineering attacks
- Denial of service (we're a single-server app)
- Issues requiring physical access to the server

## Known Limitations

We are transparent about these:

- **No E2E encryption** — messages pass through the server in plaintext. We are zero-storage, not zero-knowledge.
- **Server operator trust** — if you don't trust the operator, self-host.
- **RAM forensics** — in theory, RAM could be dumped before GC runs. This is a hardware-level attack requiring physical server access.

## Hall of Fame

We recognize security researchers who help keep BurnChat safe. With your permission, we'll list you here.

*No entries yet — be the first!*
