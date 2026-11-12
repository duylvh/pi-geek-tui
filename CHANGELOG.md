# Changelog

Forked from pi-droid-styling 2.18.0; earlier history: https://github.com/sting8k/pi-droid-styling/blob/main/CHANGELOG.md

## 0.2.1 - 2026-11-12

### Added
- The slash-command panel also opens for a `/command` typed mid-prompt, after a space or at the start of any line. Pi only offers those suggestions with an extension such as [pi-inline-slash-commands](https://github.com/duylvh/pi-inline-slash-commands). Tab-forced path completion such as `cat /Us` keeps Pi's file list.
- Notices (warnings, errors, status lines) and markdown headings wrap like CSS `text-wrap: balance`. Text that wraps onto two to six lines is re-wrapped at the narrowest width that keeps its line count, so it no longer ends in a short stub line.

### Fixed
- Pi starts straight into the geek editor. Pi's own editor and footer used to flash for a moment first, and Rex drew a large cursor block at the left edge while they showed.
- The input cursor no longer reaches the last column. With `horizontalPadding: 0`, a full input row put the cursor block in the edge cell, which Rex stretches across its window padding into an oversized block.
- A drag selection over the input editor highlights and copies only the typed text. It used to invert the `›` prompt, hide the cursor block, and paint part of the rule row.
- Fullscreen clicks now toggle what you clicked. A click on a tool group expands or collapses that group, and a click on a collapsed thinking row shows that run. Pi hit-tested its own row layout, which tool groups and head rows change, so clicks used to toggle a hidden component and look broken.

## 0.2.0 - 2026-10-19

### Added
- Pasted images become `[Image #N]` tokens in the input (ported from pi-droid-styling). The image is copied to the session directory, one Backspace deletes the token, the token links to the copy in the chat, and submit sends the image when the model accepts images (the file path otherwise). `imageAttachments`, on by default.

## 0.1.0 - 2026-10-13

First release of pi-geek-tui, a single fixed terminal look for Pi 1.x. Screenshot and details in the README.

### Added
- A continuous rail down the chat. User and agent turns start with a head row (bold name, faint host, path and branch), and the user's prompt sits on a light surface.
- Tool calls are one row each: a badge and the main argument for Pi's built-in tools (`R` read, `$` bash, `E` edit, `W` write, `G` grep, `F` find, `L` ls), and the name plus `key value` pairs for any other tool. Consecutive calls fold under a `Done(N tool calls)` / `Running(…)` head, and Ctrl+O expands them with dim output.
- An input zone without a box. The head row shows the working-tree diff (`+N -N ~F`) and a matrix-scramble live state word.
- A one-row statusline: thinking-level badge, model, context use and cache hit, plus extension statuses. Context use is always kept.
- A slash-command panel above the input. Settings, model, resume and tree selectors use the same panel, height cap and windowing.
- Streamed answers reveal smoothly with a short fade at the end of the text (`revealAnimation`, on by default).

### Changed (from pi-droid-styling 2.18.0)
- Requires Pi 1.x: the peer dependency range for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` is now `>=1.0.0 <2.0.0`. Pi 0.x is no longer supported.
- The extension no longer looks for `pi-ctx-kit`'s enhanced edit core to register its own `edit` tool. `pi-ctx-kit` dropped that core in 2.1.0, so the builtin `edit` (styled as before) is always used.
- Tool results no longer carry an unused `__outputChars` count in `details`. `__elapsedMs` is still stamped.
- Removed the dedicated renderers for the third-party `quick_edit`, `substitute_edit` and `target_edit` tools (no installed extension provides them any more). Their calls in old sessions now show as generic tool rows.
