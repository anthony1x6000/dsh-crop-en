# dsh-crop-en

English overlay for [`agent-crop-dsh`](https://github.com/oriliz/agent-crop). It installs **alongside** Agent Crop — no fork, no replacement package — and translates the plugin's original package in place.

Agent Crop has no locale layer: its panel copy, tool descriptions, injected protocol text and CLI output are Chinese literals in the shipped files. This bundle keeps a dictionary for the installed release and rewrites those literal spans at activation.

## What turns English

| Surface | File | When it shows |
| --- | --- | --- |
| Web panel (sidebar row, view tab, cards, tables) | `dsh/lib/client.js` | page refresh / client HMR |
| `crop_*` tool descriptions + injected crop protocol + `crop-retro` skill | `dsh/lib/index.js` | DSH restart |
| `crop` CLI, reminders, tool results, health report | `core/*.py`, `bin/crop` | next call |

Strings only: the dictionary is applied to string-literal spans, never to code or comments, and a `node --check` / `py_compile` gate runs on the fixture in CI-style tests.

## Install

```bash
node --test test/*.test.mjs
```

Then install the directory as a bundle (Plugins > Add plugin, or `plugin_manager install_bundle` targeting this directory). It patches the `agent-crop-dsh` already installed in the same profile.

## After install

- Python output is English on the next call.
- The Web panel reloads from disk: refresh the page (the host serves the client bundle by content hash).
- Tool descriptions and the system-prompt protocol arrive with the next DSH start, because the host imports that module once per process.

If Agent Crop is upgraded, the next activation re-translates the new files; strings that changed upstream are reported as stale in the log (`[crop-en] ...`) and left as-is.

## Restore

`lib/patch.mjs` exports `restoreTarget({ targetDir })`, which copies the pre-translation files back from `<agent-crop-dsh>/.crop-en/originals/`.

## Development

- `lib/scan.mjs` — literal scanner + masking (JS/Python).
- `lib/patch.mjs` — dictionary loader, patcher, manifest, restore, coverage gate.
- `lib/target.mjs` — locates the installed `agent-crop-dsh` (profile, `DSH_PROFILE_DIR`, `DSH_HOME`, `CROP_EN_TARGET`).
- `tools/derive-maps.mjs` — turns translated copies in `.tmp/en/` into `translations/<version>/*.json`, proving each dictionary reproduces the translated file exactly.
- `tools/verify-installed.mjs` — checks the live installed package, the host module and `crop --help` for leftover Chinese.

## Credits

Agent Crop © oriliz, MIT. This bundle only ships a translation dictionary plus a small patcher; the vendored fixture under `test/fixtures/` is upstream source, kept for the translation gate. See `NOTICE`.
