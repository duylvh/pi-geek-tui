# Product Overview

`pi-geek-tui` is an opinionated Pi UI styling extension.

## User-Facing Behavior

One fixed look (fixed palette, configurable accent); the visual contract is `docs/design/geek-ui-spec.md`.

- Startup header: one title line (`── π pi ── ~/path ── session · turn N ──`) instead of Pi's logo and resource list.
- Conversation in the rail grammar: every row is a 3-cell rail plus body; `•` head rows (`user@host path (branch)`), dashed `┊` continuation, no timestamps.
- Tool calls: one row per call (badge + primary argument for Pi built-ins, name + `key value` pairs otherwise), consecutive calls folded under a `Running(…)` / `Done(…)` head, split diffs for edit/write, `Ctrl+O` for output.
- Box-less input zone: head row with cwd, branch, working-tree diff and the live agent state; `› ` prompt row.
- Slash-command panel above the input head (keyboard and mouse), and the same panel look for every selector/dialog Pi puts in the editor slot.
- One-row statusline footer: accent-colored thinking-level label without a filled background, provider · model, context tokens/percent, cache-hit percent, extension statuses.
- Render hot-path patches for streaming assistant output and noisy tool output; during a real assistant stream the presentation buffer drip-feeds deltas at the 33 ms cadence and the finished-render cache stays bypassed, both keyed on the extension-tracked stream state rather than `message.stopReason`.
- Fullscreen exit restores the shell without a transcript/UI dump, even when Pi’s `fullscreenExitOutput` setting is `transcript`; saved sessions retain Pi’s resume hint and history. Regular-mode exit behavior is unchanged.
- Non-Windows hosts sync the terminal background with OSC 11 to cover terminal-owned padding.
- Opt-in render profiling for request/render/repaint/update/git metrics without changing UI behavior when disabled.

## Configuration

Stored at `~/.pi/agent/pi-geek-tui.json`; every key, its default and its effect is listed in the README `Config` section.
Keys left over from the droid-styling era (`presentationStyle`, `userZoneStyle`, `inputBox`, `fixedUserZone*`, `diffMode`, `dimToolOutput`) are removed from the file on load and have no effect.

## Compatibility Expectations

- The extension should use explicit frame/component rendering for terminal cells and keep OSC 11 disabled on Windows/WSL/Windows Terminal unless `forceOSC11` is enabled.
- `transparentBackground` should skip page/frame background painting, tool-row and user-message backgrounds, and reset OSC 11; real selections and split-diff backgrounds stay opaque.
- Patch installers should be reload/session safe and avoid stacked patches.
- Performance patches should preserve final message/tool correctness while coalescing partial updates.
- Profiling should be opt-in and should emit aggregate JSONL summaries rather than per-render logs.
- Git status and assistant speed are best-effort UI hints, not correctness-critical product state.

## Validation Expectations

- `npm run check`: typecheck, every smoke in `npm test`, and `npm pack --dry-run`.
- A live Pi run (render, screenshot or capture) for user-visible rendering changes.
