# Contributing to BurnChat

Thanks for your interest in contributing! BurnChat is intentionally simple — a single backend file and a single frontend file — and we'd like to keep it that way.

## Ground Rules

1. **Zero storage is sacred.** Never add database dependencies, disk writes, or persistent logging. If your change writes to disk, it won't be merged.
2. **Keep it simple.** No build steps, no bundlers, no frameworks. Vanilla JS only.
3. **Node 12+ compatible.** Use CommonJS (`require`), not ES modules.

## How to Contribute

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Test locally (`npm install && node server.js`)
5. Commit (`git commit -m 'Add feature X'`)
6. Push (`git push origin my-feature`)
7. Open a Pull Request

## Good First Issues

Look for issues labeled `good-first-issue` — these are small, well-scoped tasks perfect for new contributors.

## What We're Looking For

- Security improvements
- Performance optimizations
- Accessibility improvements
- Mobile UX improvements
- Translations / i18n
- Documentation fixes

## What We're NOT Looking For

- Database integrations (by design)
- User account systems (by design)
- Analytics or tracking (by design)
- Heavy framework dependencies
- Build steps or transpilation

## Code Style

- 2-space indentation
- Single quotes for strings
- Semicolons required
- Descriptive variable names

## Questions?

Open an issue or reach out on Twitter [@burnchatio](https://x.com/burnchatio).
