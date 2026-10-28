---
name: marketing-video
description: Record narrated marketing videos of Surco use cases (screen recording of the real app + Spanish voice-over + subtitles + zoom + end card). Use when asked to make, redo or add a demo/marketing video of a Surco scenario.
---

Each video drives the **built** app with Playwright's `_electron` (same approach as
`run-desktop`), records it with CDP `Page.startScreencast`, voices a script with macOS
`say`, and assembles a 1920x1080 MP4 with ffmpeg.

All paths below are relative to this skill's directory.

## Run

```bash
node video.mjs <case>                # prepare (first time), voice, record, build
node video.mjs <case> --prepare      # rebuild the input fixtures first
node video.mjs <case> --build-only   # re-assemble from the last recording
```

Cases live in `cases/<case>/`: `apple-music`, `calidad`, `titulos`, `carpeta`, `cues`.
The MP4 lands in `$SURCO_VIDEO_DIR/out/surco-<case>.mp4`.

| Variable | Default | Meaning |
|---|---|---|
| `SURCO_VIDEO_DIR` | `$TMPDIR/surco-video` | Work dir: fixtures, frames, voice, output |
| `SURCO_VIDEO_MUSIC` | `/Volumes/Public/Music/Media.localized/Music` | Library the fixtures are copied from (the NAS must be mounted) |
| `SURCO_VIDEO_VOICE` | `Mónica` | `say` voice |

Prerequisites: the app built in `apps/desktop/out/` (the main checkout's build is used
when the current tree has none) and `playwright-core` installed in `run-desktop`.

## The home hero loop

`node hero.mjs [--lang es,en]` records the muted loop under the home headline (and on
/funciones) in every app language: the folder `SURCO_HERO_DIR` (default
`/Volumes/Public/Musica/FLAC/bases buenas`) opened, one track picked, its Discogs match
applied and the track converted. No cursor, no voice. It writes
`apps/web/public/hero-app-<lang>.{webm,mp4,webp}`; the still is the clip's first frame.
The conversion goes to a throwaway profile.

## A case

- `lines.json`: one entry per step. `say` is what the voice reads (spell it
  phonetically: "guav", "aif", "emepetrés"); `sub` is the subtitle with the real text.
- `prepare.mjs`: builds the input files under the work dir. Commercial tracks are
  copied from the library at record time and are never committed.
- `record.mjs`: opens a `session(name, settings)` and runs `step(id, fn)` per line.
  Each step waits for its line's duration, so the voice paces the recording.
  Helpers: `clickOn`/`glide`/`glideTo` move a painted cursor (Playwright draws none),
  `key` shows a keycap, `zoomAt(cx, cy, scale)`/`unzoom()` record a camera move in
  CSS pixels of the 1440x810 window.

Zoom events are stored in `timeline.json`, so a framing can be fixed by editing that
file and running `--build-only` without recording again.

## What each case touches

Every session uses a throwaway `--user-data-dir`, deleted on exit.

- `apple-music` **adds a track to the real Apple Music library**. Remove the entry
  (and the file Music copied into its media folder) afterwards.
- `carpeta` reads `discogsToken` from the real Surco settings: auto-match needs it,
  and without it Discogs throttles after a few takes. The token only lives in the
  throwaway profile.
- `cues` copies `~/Library/Pioneer/rekordbox/master.db` and one track's ANLZ into the
  work dir, clears that track's cues, renames playlist `1096465097` to "Himnos" and
  hides playlists named after gigs, all in the copy. The real collection is only read.
- `calidad`'s `prepare.mjs` runs the app for 90 s to warm the analysis cache, so the
  verdicts appear at once in the take.

## Gotchas

- Discogs opens the suggested release on its own; clicking it folds it.
- Find and replace stays open after replacing; close it with `find-replace-cancel`.
- The cue section only exists with a rekordbox playlist open. Accept the proposal with
  a click (Enter needs focus there), then the arrows move between cues.
- Auto-match is not deterministic between takes: do not narrate an outcome that only
  some takes show.
