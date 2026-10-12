# pi-geek-tui

Hancore-inspired geek terminal UI for Pi: a timestamp gutter and continuous rail, collapsed tool groups, a box-less input zone with a live state, a two-row stats footer, and reload-safe render patches. One fixed look; design spec in [`docs/design/geek-ui-spec.md`](docs/design/geek-ui-spec.md).

## Install

```sh
pi install npm:@sting8k/pi-geek-tui
```

Or install directly from Git:

```sh
pi install git:github.com/sting8k/pi-geek-tui
```

## Look

The palette is fixed (page background `#0c0c0c`) and does not depend on the selected Pi theme. Only the accent is configurable: `π`, headings, the running rail, progress fills and the live state use it. Pick one of `#dd5670` (default), `#d8785b`, `#88c6a3`, `#d8d4b4`, or any `#rrggbb` / `#rgb` hex via `accent`.

## Features

### Look and feel

- **Startup header.** `π pi` with the session name and turn count instead of a logo and resource list.
- **Input zone without a box.** A head row (time, `user@host`, path, git branch) with the live agent state on the right (`▂▄▆▄ thinking · 2.3s`), then a `› ` prompt row with an ink block cursor.
- **Two-row footer under a rule.** `ctx` bar with percent/window and model + thinking level; `tok` with ↑ input, ↓ output, R/W cache, cache-hit % and session cost. Extension statuses appear on a third row when present.

### Built for the terminal

- **Smoother while the model works.** Streaming text and fast tool updates are batched into steady frames instead of repainting on every token.
- **Stays aligned when you resize.** Boxes, labels, and right-aligned status account for terminal escape codes, so they wrap and truncate cleanly.
- **Long sessions stay fast.** Only the newest part of the chat is rendered, while huge tool results are capped so history does not slow you down.
- **Reloads stay clean.** UI patches are applied once and removed cleanly, so extension reloads and session switches do not stack layout changes.

## Config

Config is stored at `~/.pi/agent/pi-geek-tui.json`:

```json
{
  "alwaysExpanded": false,
  "maxExpandedLines": 50,
  "accent": "#dd5670",
  "customWorkingMessage": {
    "working": "working",
    "thinking": "thinking",
    "answering": "answering",
    "running": "running"
  },
  "tasksWidgetStyle": "compact",
  "collapsedThinking": "tail",
  "forceOSC11": false,
  "transparentBackground": false,
  "visibleChatTail": 30,
  "revealAnimation": true
}
```

| Setting | Options | Default | What it does |
| --- | --- | --- | --- |
| `alwaysExpanded` | `true`, `false` | `false` | Open tool output by default. `Ctrl+O` still toggles it. |
| `maxExpandedLines` | `0`–`1000` | `50` | Limit expanded tool output. Use `0` for no limit. |
| `accent` | `#dd5670`, `#d8785b`, `#88c6a3`, `#d8d4b4`, or any hex | `#dd5670` | Accent color (see Look). |
| `customWorkingMessage` | Custom text | See example | Rename the live-state words shown in the input head row. You can set only the ones you want to change. |
| `tasksWidgetStyle` | `compact`, `default` | `compact` | Use the one-line tasks widget, or leave the original `pi-tasks` widget unchanged. |
| `collapsedThinking` | `tail`, `label` | `tail` | While thinking is hidden (`Ctrl+T`), each collapsed thinking row shows the end of the thinking text with a `▸` live marker (`·` once the run is done). `label` restores the static label. |
| `forceOSC11` | `true`, `false` | `false` | Force terminal background sync on Windows/WSL. Usually leave this off. |
| `transparentBackground` | `true`, `false` | `false` | Stop painting the page/frame background and tool rows, and reset OSC 11, so the terminal's own background (wallpaper, blur) shows through. Selections and diff accents stay opaque. Dim/blur is tuned on the terminal side (Ghostty `background-image`, kitty `background_image`, WezTerm `window_background_image`). |
| `visibleChatTail` | `0` or more | `30` | Render only the newest N chat items for speed. Use `0` to render everything. |
| `revealAnimation` | `true`, `false` | `true` | Streamed answers appear character by character with the newest characters fading in (truecolor). Finished and resumed messages always show at once. `false` (or `PI_REDUCED_MOTION=1`) shows streamed text in chunks. |

## Profiling

Render profiling is disabled by default. To capture render/update/git metrics plus memory, CPU delta, and event-loop utilization:

```sh
PI_GEEK_PROFILE=1 PI_GEEK_PROFILE_OUT=/tmp/pi-geek-profile.jsonl pi
```

Useful environment variables:

- `PI_GEEK_PROFILE=1` enables profiling.
- `PI_GEEK_PROFILE_OUT=/path/profile.jsonl` writes JSONL output. Use `stderr` or `stdout` for stream output.
- `PI_GEEK_PROFILE_INTERVAL_MS=5000` controls summary cadence.

Synthetic self-check:

```sh
npm run profile:render
```

The synthetic bench exercises footer/editor rendering, render throttle, assistant/tool debounce, and git status refresh. Runtime terminal paint/GPU cost still needs a real Pi TUI capture.

## Notes

- Colors come from the fixed palette, not the active Pi theme; it paints TUI cells explicitly and uses OSC 11 terminal background sync on non-Windows hosts to cover terminal-owned padding/remainder areas. Windows/WSL/Windows Terminal skip OSC 11 unless `forceOSC11` is enabled.
- `transparentBackground: true` skips page/frame background painting and resets OSC 11 so the terminal's own default background (wallpaper, blur) shows through. Real selections and diff accents stay opaque for readability.
- Set `working`, `thinking`, `answering`, and `running` in `customWorkingMessage` to customize the live-state words.
- Existing legacy `customWorkingMessage: true` or `false` values are normalized back to the default label object.

## License

MIT
