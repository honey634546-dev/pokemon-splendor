# Repository Guidelines

## Project Structure & Module Organization

This is a static browser game with no bundler or application build step.

- `index.html`, `css/`, `assets/`, `manifest.json`, and `sw.js` comprise the web/PWA client.
- `js/engine.js` is the browser/Node rules engine; `ai.js`, `vsearch.js`, and `ai.worker.js` implement computer play. `ui.js`, `tutorial.js`, and `net.js` handle UI, onboarding, and transport.
- `js/room.js` is the transport-agnostic, server-authoritative online-room layer; `worker/index.js` adapts it to a Cloudflare Durable Object.
- `data/` contains card databases; `assets/` contains card art and media. Treat generated `js/cards.js` as read-only.
- `test/` contains executable Node regression tests. `train/` contains optional Python AI training; `docs/` contains design notes.

## Build, Test, and Development Commands

Run commands from the repository root; there is no `package.json`-based build.

```bash
python -m http.server 8000       # serve at http://localhost:8000
for f in test/*.test.js; do node "$f"; done  # run all regression suites
npx wrangler dev                  # local Worker/Durable Object development
npx wrangler deploy               # deploy static assets and online rooms
```

For focused work, run one suite, such as `node test/room.test.js`. Training commands are in `train/README.md`.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and the existing mostly-single-quoted JavaScript style. Keep modules compatible with browser globals and Node/CommonJS where the surrounding file does so. Use `camelCase` for functions/variables, `PascalCase` for classes (for example, `Room`), and descriptive action/test names. Preserve data IDs (`s1_01`, `pmL1`, etc.) and do not hand-edit generated card data.

## Testing Guidelines

Tests use Node’s built-in `assert` and are named `test/<area>.test.js`. Add deterministic, behavior-focused coverage beside the changed module; include rule invariants, redaction/authority checks, or expansion-off compatibility when relevant. No coverage threshold is configured. Run the full suite before submitting.

## Commit & Pull Request Guidelines

Recent commits use concise imperative descriptions, often with `fix:` or `docs:` prefixes and an issue/PR reference such as `(#31)`. Follow that pattern where useful and keep unrelated changes separate. PRs should explain behavior and affected paths, list test results, link issues, and include screenshots for UI/PWA changes. Call out Wrangler/configuration changes, and never commit `.env`, `.dev.vars`, or secrets.

## Architecture & Security Notes

Keep rules in the pure engine/room layers, not Worker transport. Preserve server-side validation, per-seat redaction, token-based reconnects, and server-minted online-game seeds when modifying multiplayer code.
