# Changelog

Forked from pi-droid-styling 2.18.0; earlier history: https://github.com/sting8k/pi-droid-styling/blob/main/CHANGELOG.md

## Unreleased

### Changed
- Requires Pi 1.x: the peer dependency range for `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` is now `>=1.0.0 <2.0.0`. Pi 0.x is no longer supported.
- The extension no longer looks for `pi-ctx-kit`'s enhanced edit core to register its own `edit` tool. `pi-ctx-kit` dropped that core in 2.1.0, so the builtin `edit` (styled as before) is always used.
- Tool results no longer carry an unused `__outputChars` count in `details`. `__elapsedMs` is still stamped.
- Removed the dedicated renderers for the third-party `quick_edit`, `substitute_edit` and `target_edit` tools (no installed extension provides them any more). Their calls in old sessions now show as generic tool rows.
