# US-027 Clean fullscreen exit and inline footer label

## Status

complete

## Lane

normal — bounded exit-rendering and footer presentation changes.

## Product Contract

Fullscreen exit restores the shell without dumping the session UI. The thinking-level label shares the footer text baseline without a filled background. Session storage and regular-mode exit remain unchanged.

## Relevant Product Docs

- [Product overview](../product/overview.md)
- [Footer design](../design/geek-ui-spec.md#9-footer-rule--one-statusline-row-directly-under-the-input--no-blank-row-between)
- [README](../../README.md)

## Acceptance Criteria

- Ctrl+D in fullscreen mode returns to the shell without transcript, input, or footer rows.
- Saved-session resume hints and session history remain owned by Pi.
- The exit patch is idempotent across reloads and leaves regular-mode behavior unchanged.
- Thinking and bash labels use foreground color only, with unchanged spacing, truncation, and one-row footer layout.

## Design Notes

- `exit-ui.ts` wraps Pi's `stopInteractiveTui`, using the existing `resume-hint` exit policy only in fullscreen mode. `index.ts` installs the patch.
- `editor/statusline.ts` replaces the label's filled background with foreground color; its width allocator stays unchanged.
- No user settings, terminal scrollback, or session files are changed.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | `npm run test:statusline`: label colors, no filled background, existing width and truncation checks. |
| Integration | `npm run test:geek-frame`: real Pi exit method, fullscreen/regular policies, repeated installation. |
| Platform | Isolated live Pi fullscreen Ctrl+D and footer capture. |
| Release | `npm run check`, `git diff --check`. |

## Harness Delta

The documented `scripts/bin/harness-cli` is absent, so intake/story/trace database commands cannot run. Use this story as the local evidence record without changing Harness policy. The test-audit skill does not cover the repository's standalone Node smoke runner; retain the established scripts rather than introduce a new framework.

## Evidence

- Pre-fix frame smoke failed on fullscreen/transcript mode switching and screen-preservation assertions.
- Pre-fix statusline smoke failed for all six thinking labels and bash mode because they used a filled background.
- Both focused smokes and `npm run typecheck` pass after the repair.
- `npm run check` passes after the final test edit: typecheck, all repository smokes, and package dry-run. `git diff --check` passes.
- Live managed Pi 1.2.0 in a 100×32 PTY passes with `fullscreenExitOutput: transcript`: Ctrl+D exits with status 0, restores the primary screen, emits no session/input/footer dump, and renders `HIGH` with accent foreground and no accent background.
- Live saved-session fixture retains the resume hint without dumping its user message. No model request was made; settings, config, and session storage were isolated in a temporary home. The existing auth file was linked for model availability; no credentials were copied and no provider request was issued.
- The installed extension at `~/.pi/agent/git/github.com/duylvh/pi-geek-tui` received only `index.ts`, `exit-ui.ts`, and `editor/statusline.ts`; the live saved-session check also passes against that installed copy.
- Independent read-only review found no blocking correctness or crash regressions. Added a wrapper-identity assertion to prove repeated installation does not stack. The fullscreen exit policy intentionally applies to all fullscreen exits and is documented; the existing prototype-patch lifetime convention remains unchanged.

## Local Trace

- Outcome: completed.
- Actions: inspect screenshot/source and Pi 1.1.0/1.2.0 exit paths; prove pre-fix regressions; repair exit policy and footer styling; run focused/full/live validation; review; sync installed source.
- Source changes: `exit-ui.ts`, `index.ts`, `editor/statusline.ts`.
- Test changes: `scripts/geek-frame-smoke.mjs`, `scripts/statusline-smoke.mjs`.
- Documentation changes: `README.md`, `docs/design/geek-ui-spec.md`, `docs/product/overview.md`, this story.
- Friction: Harness CLI is missing; the preferred reviewer task could not start because its declared skills are absent, so an independent read-only agent performed the review. Isolated live checks first encountered the trust dialog and unavailable models; the final runs ignore project resources and use the existing auth source without issuing provider requests.
- Remaining visual limitation: verified ANSI output and real PTY lifecycle, not a new screenshot in the user's terminal emulator. The foreground-only label avoids relying on emulator-specific background cell height.
