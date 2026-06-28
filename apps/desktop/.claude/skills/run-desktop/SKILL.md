---
name: run-desktop
description: Build, run, and drive the Surco desktop app (Electron). Use when asked to start Surco, run the desktop app, build it, take a screenshot of its UI, drive the player/editor, or verify a renderer change in the real app.
---

Surco is an Electron app (`apps/desktop`, package name `surco`): a React 19 renderer
in a Tokyo-Night UI for cleaning up DJ track metadata. Drive it via
`.claude/skills/run-desktop/driver.mjs`, which launches the **built** app with
Playwright's `_electron` and steers the renderer (inject a track, open the player,
screenshot). This is verified on **macOS** with a real window — there is no headless
Linux path here.

All paths below are relative to `apps/desktop/`.

## Prerequisites

- macOS with a display (the window is headed; screenshots capture the real window).
- `pnpm` and Node (already set up in this repo).
- Electron's binary must be installed at the **repo root** `node_modules/electron`
  (it is, via pnpm hoist). The copy under `apps/desktop/node_modules` has no binary —
  the driver resolves Electron from the root on purpose.
- `ffmpeg-static` at the repo root (ships with the app's deps) — the driver uses it to
  synthesize a tone WAV so the player has audio to load.

## Setup

The driver's one dependency (`playwright-core`) lives in **this skill's own**
`node_modules`, kept out of the app manifest so the project's `package.json` stays
clean. Install it once:

```bash
cd apps/desktop/.claude/skills/run-desktop && npm install
```

`playwright-core` reuses Electron's bundled Chromium — no browser download.

## Build

The driver runs the compiled app in `apps/desktop/out/`, so build first (and rebuild
after any renderer/main change you want to see):

```bash
cd apps/desktop && PATH="$(git rev-parse --show-toplevel)/node_modules/.bin:$PATH" electron-vite build
```

Note: `pnpm build`/`pnpm test` trigger a `pnpm install` prehook that fails on this repo's
ignored build scripts — call the underlying binaries directly (as above, and for tests
below) to skip that.

## Run (agent path)

From the skill dir. **smoke** does the whole flow and exits non-zero on failure:

```bash
cd apps/desktop/.claude/skills/run-desktop && node driver.mjs smoke
```

It launches the app, injects a 5s tone WAV (as if opened from Finder), double-clicks the
track row to open the floating player, hovers it, and writes `/tmp/surco-player.png`.
Expected stdout:

```
OK player up, volume pill shows "100%", screenshot: /tmp/surco-player.png
```

**Always open and look at `/tmp/surco-player.png`.** The player card sits bottom-left with
the volume slider, transport controls, and the editor panel filled on the right.

**repl** mode drives it interactively — feed commands on stdin (wrap in tmux for a live
session, or pipe for a script). A full open-player flow:

```bash
cd apps/desktop/.claude/skills/run-desktop
printf 'launch\ntone 5\nplay\nss player\nquit\n' | node driver.mjs repl
```

Commands: `launch` · `tone [secs]` (make + open a tone WAV) · `open <wavPath>` ·
`play` (double-click the track row → open the floating player) · `ss <name>`
(→ `/tmp/surco-<name>.png`) · `click <selector>` · `eval <js>` (prints JSON) · `quit`.
Selectors use the renderer's `data-testid`s — e.g. `[data-testid="player"]`,
`[data-testid="track-row"]`, `[data-testid="player-volume-slider"]`,
`[data-testid="player-volume"]` (the % readout).

After `tone`, the player is **not** open yet — run `play` (or `click`/`eval` your own
double-click) to mount it; `eval document.querySelector('[data-testid=player]')!=null`
confirms.

## Run (human path)

`electron-vite dev` opens a live window with HMR. Useful for hand-testing, useless for
automated capture (it blocks and needs a human). Run it from `apps/desktop` with the
repo-root `node_modules/.bin` on `PATH` (same as the build line), then Ctrl-C.

## Direct invocation (internals)

Most main-process logic (ffmpeg, tags, waveform, tempo, key, loudness…) is pure and
covered by colocated `*.test.ts`. For a PR that touches one of those, skip the GUI and run
its test directly via the vitest binary (avoids the install prehook):

```bash
# vitest is hoisted to the repo root, so call it by its root path:
cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run src/main/<file>.test.ts
# whole suite:
cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run
```

Renderer components (e.g. `src/renderer/src/components/Player.tsx`) likewise have
`*.test.tsx` under jsdom — same runner.

## Gotchas

- **Two `out/` dirs are confusing.** `electron-vite build`'s log prints `../../out/...`
  (relative to an internal cwd) but the real output is `apps/desktop/out/`, which is what
  `package.json` `main` and the driver point at.
- **Electron resolves from the repo root, not the app.** `apps/desktop/node_modules/electron`
  has no binary (build scripts are ignored there); `require('electron')` from the skill dir
  would throw "Electron failed to install correctly." The driver builds a `require` based at
  the repo root to get the hoisted binary.
- **The smoke player opens in the slim (no-waveform) layout** — the volume slider lives there
  too (speaker icon + range + `%`). The other layout floats the same pill over the waveform and
  fades it in on hover; the player's own waveform toggle (`[data-testid="player-waveform"]`) is
  inside the player card, next to the transport buttons. Click it *after* `play` to flip layouts —
  not before the card exists.
- **The synthetic tone DOES analyze:** the Audio Quality panel grades it "Good quality" with a
  ~20 kHz cutoff and real loudness numbers once that section is open. (A first screenshot taken
  before the panel finishes may briefly read "Could not analyze the audio" — that's the analysis
  still running, not a failure.)
- **The player card hides its pills until hovered.** The driver hovers before screenshotting;
  in the REPL, `eval` a `.hover()` or just screenshot right after a `click` that left the
  pointer on the card.

## Troubleshooting

- `Build missing: .../out/main/index.js` → run the Build step.
- `Cannot find module 'playwright-core'` → run the Setup `npm install` in the skill dir.
- `pnpm install ... ERR_PNPM_IGNORED_BUILDS` when running `pnpm build`/`pnpm test` → call the
  binary directly (the `electron-vite` build line, or `../../node_modules/vitest/vitest.mjs`)
  instead of the pnpm script.
- Player never appears (`waitForSelector ... player` times out) → the track row didn't load;
  check the tone WAV exists and that `open-files` reached the window (`eval` the row count:
  `document.querySelectorAll('[data-testid=track-row]').length`).
