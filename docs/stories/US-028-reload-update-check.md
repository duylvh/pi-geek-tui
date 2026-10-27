# US-028 Update check after reload

## Status

complete

## Lane

normal — bounded lifecycle wiring and one small runtime helper.

## Product Contract

After `/reload`, Pi or package updates that exist are shown again as a warning notice, and `/check-updates` shows the same notice on demand ("No updates available" when there is none). Pi's own startup check and notices are unchanged.

## Relevant Product Docs

- [README](../../README.md)
- [Architecture](../ARCHITECTURE.md)

## Acceptance Criteria

- `session_start` with reason `reload` starts the check in the background; it never delays the reload and never runs on startup, new, resume, or fork.
- `/check-updates` notifies the notice, or "No updates available" at info level.
- A result is dropped when the session changed meanwhile, and a stale context never throws.
- `PI_OFFLINE` skips both checks; `PI_SKIP_VERSION_CHECK` skips the Pi version check. Failures resolve to no updates.

## Design Notes

- Data shape: `AvailableUpdates { pi?: string; packages: string[] }` in `core/update-check.ts`, with `checkAvailableUpdates(cwd)` (never rejects) and `formatUpdateNotice`.
- Pi does not export its version check from the package root, so the `pi.dev/api/latest-version` check is reimplemented. Package updates use the exported `DefaultPackageManager.checkForAvailableUpdates()`.
- `index.ts` only wires the two triggers, reusing `sessionRunSerial` and `isStaleContextError`.
- No config option, cache, or new dependency.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:update-check`: notice wording for none, Pi only, packages only, both; offline check resolves to `{ packages: [] }` without network. |
| Typecheck | `npm run typecheck`. |
| Release | `npm test`, `git diff --check`. |

## Harness Delta

The documented `scripts/bin/harness-cli` is absent, so intake/story/trace database commands cannot run. Use this story as the local evidence record without changing Harness policy. The repository's standalone Node smoke runner is retained rather than introducing a new framework.

## Evidence

- `npm run test:update-check`, `npm run typecheck`, and `npm test` pass.
- Not exercised live: the network Pi-version path and the real reload and `/check-updates` flow in a running Pi.
