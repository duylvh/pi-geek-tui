# pi-geek-tui — UI spec (from mockup V2 "editor hancore")

Source of truth: `design/mockup-v2.zip` (`V2.dc.html`, inline styles + `<style>` block).
Inspiration: https://hancore.dev/site/#stack. Mockup text is Vietnamese; **all shipped UI text is English**
(translations listed below). Engine (render perf, physical sync, virtualization, patch install/uninstall)
is forked from pi-geek-tui and must keep working — change visuals, not the engine.

## Palette (fixed; no pi-themes dependency)

| role | hex | used for |
|---|---|---|
| bg | `#0c0c0c` | page background (OSC 11 when enabled) |
| ink | `#d8d4b4` | normal text, user name, user rail dot, cursor block |
| dim | `#a8a385` | secondary text (`@host`, `// meta`, labels) |
| faint | `#525b54` | separators ` · `, backticks, `^o`, line numbers, `░` empty bar, tree glyphs |
| num | `#d8785b` | numbers, `$` (bash) badge bg |
| kw | `#689e80` | `(branch)`, keywords, thinking level, agent rail dot, finished tool rail `┃`, edit badge bg, ctx bar fill |
| str/mono | `#88c6a3` | inline code text, `+N`, `+` diff marker |
| punct | `#727060` | `~/path`, code punctuation |
| rail | `#3a3a34` | idle rail `│` |
| rule | `#2a2a26` | footer horizontal rule `─` |
| accent | `#dd5670` default; config options `#dd5670` `#d8785b` `#88c6a3` `#d8d4b4` | `π`, `## heading`, list `-`, active rail `┃`, running state, progress fill, thinking spark |
| del | marker `#dd5670`, row bg `#251518` | diff removed |
| add | marker `#88c6a3`, row bg `#1b221e` | diff added |
| badge default | bg `#a8a385`, fg `#0c0c0c` | 1-cell tool badge (`R`, `T`…) |

## Layout grammar (columns, monospace cells)

Every conversation row = `gutter(5, right-aligned time, dim @55%) + rail(3, centered glyph) + body`.
Whole UI has a left/right margin (mockup: 4ch inside the window padding) — reuse tui-padding.

Rail glyphs: `•` head of a block (ink for user, kw for agent), `│` continuation (rail color),
`┃` on every row of a tool block (summary head, tree, edit/write rows): accent while it runs, kw once finished,
del marker (`#dd5670`) if any call failed. ` ` (blank) on the input row.
Blank separator rows — including the one closing a tool block — keep the rail `│` so the rail is continuous through a turn.

### 1. Startup header (replaces pixel logo)
One title-bar line on the rule (rail color `─`), text segments with one space each side, 2 rule cells before the first and after the last:
```
── π pi ─────────────────── ~/code/kpi-api ─── refresh-ttl · turn 2 ──
```
Left `π` accent + ` pi` ink; middle cwd (home → `~`) dim, kept next to the right segment (3 rule cells between);
right session name ink + dim ` · ` + dim `turn N`. No session name: just `turn N`; no turns yet: just the name.
Narrow widths drop, in order: cwd (left-truncated with `…` first), `turn N`, session name; `π pi` always stays. Never wraps.

### 2. Message head row
`14:52 • bean@kpi-api ~/code/kpi-api (fix/refresh-ttl)` — name ink, `@host` dim, path punct, branch kw.
Agent: `pi@agent …` with kw dot. Time = message timestamp HH:MM, only on head rows.

### 3. User prompt body
`│ › refresh token expires after 5 minutes, fix it` (`› ` then text, ink).

### 4. Collapsed tool group (finished)
`┃ › read session.ts token.ts · grep REFRESH_TTL            ^o  // 3 call · 1 thought · 1.9s` (`┃` kw: finished ok)
Left: `› ` + calls summarised as `verb args`, joined by faint ` · `. Right-aligned: faint `^o  ` (expand hint),
dim `// N call · N thought · ` + num seconds + dim `s`.

### 5. Assistant markdown
`## cause` accent; inline code = faint backtick + mono text + faint backtick; numbers num;
list bullet `- ` accent.

### 6. Edit call
`┃ › edit src/auth/session.ts                                  // +2 -2 · 0.1s` (`+2` mono, `-2` del marker).
Diff rows indented 2ch, fixed width block (mockup 72ch, clamp to body width) with row bg:
`  20 - const exp = now + REFRESH_TTL;` (line no faint, marker colored, code syntax-colored).
Gap: `       ··· 16 unchanged lines ···` faint.

### 7. Running tool group (expanded tree)
```
14:53 ┃ › pnpm test auth · read refresh.test.ts                 // 2 call · running · 4.1s
      ┃   ├── $ test auth          passed      11  █████████████░░░  11/14
      ┃   ├── R refresh.test.ts    lines    1'204
      ┃   └── T thinking           "3 remaining tests all call rotate() before sign…"
```
Rail `┃` accent while running (kw finished, del marker on failure); head `› ` accent; `running` accent. Tree glyphs faint. Call column 22ch:
1-cell badge (bash `$` num bg, read `R` default, think `T` accent bg, edit `E` kw bg) + space + label.
Then dim label padded to 9, num value right-aligned 6, optional progress bar (accent fill `█`, faint `░`, 16 cells) + dim `n/m`.
Number grouping uses `'` (1'204), like hancore.

### 8. Input zone (no box)
```
      • bean@kpi-api ~/code/kpi-api (fix/refresh-ttl)            ▂▄▆▄ thinking · 2.3s
        › run tests again then commit█
```
Head row = same as message head, right side shows live state: accent spark `▂▄▆▄` + accent state word
(`thinking` / `working` / `running` / `answering`) + dim ` · ` + num secs + dim `s`. Idle: right side empty.
Input row: blank rail, `› ` then editor text; cursor = ink block.

### 9. Footer (2 rows, under a rule)
```
──────────────────────────────────────────────────────────────── (rule color, full width)
  ctx █████░░░░░░░░░░░  31.4%/200k               (anthropic) claude-opus-5-5 · high
  tok ↑41k ↓6.9k  R212k W18k  CH 82.4%                                      $0.412
```
Label column = 5ch right-aligned dim (`ctx`, `tok`). Bar 16 cells: fill kw, empty faint. Numbers num, units dim.
Right: faint `(provider) `, ink model, dim ` · `, kw thinking level. Cost num.

## English strings (mockup → shipped)
| mockup | shipped |
|---|---|
| lượt 2 · cuối | turn 2 · last |
| đang chạy | running |
| nghĩ | thinking |
| ··· 16 dòng không đổi ··· | ··· 16 unchanged lines ··· |
| dòng (lines) | lines |
| call / thought | call / thought (plural not inflected, as mockup) |

## Removed from the fork
Presentation presets (droid/reasonix/claudecode), user-zone presets, input-box styles, companion pi-themes
bundle, pixel startup logo. One look only; config keeps engine knobs (alwaysExpanded, maxExpandedLines,
visibleChatTail, collapsedThinking, diffMode, transparentBackground, forceOSC11, customWorkingMessage) + `accent`.
