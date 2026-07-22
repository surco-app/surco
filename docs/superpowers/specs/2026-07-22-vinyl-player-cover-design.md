# Vinyl player cover — design

Date: 2026-07-22
Status: approved

## Goal

The 40×40 square cover in the player card becomes a vinyl record: a black disc
with subtle grooves, the track's cover art clipped into a circular center label
("galleta"), spinning while the track plays.

## Visual

- The disc replaces the square cover at the same footprint: 40px circle.
- Disc body: near-black with subtle concentric grooves rendered via
  `repeating-radial-gradient` — no image assets, no SVG.
- Label: the existing cover `<img>` clipped to a centered circle at ~50% of the
  disc diameter (20px). The realistic one-third label would leave the art at
  ~13px, unreadable.
- A tiny center dot marks the spindle hole.
- No embedded cover: same disc, plain label in `var(--color-panel)` with the
  small `Music` icon, mirroring the current placeholder.

### Iteration 2 (same day, after user reference SVGs)

- Specular sheen: two soft diagonal light reflections (top-left, bottom-right)
  on a static overlay that does NOT rotate — the sheen is the light source, so
  it stays put while the grooves and label spin underneath. The rotating disc
  becomes an inner element; the outer wrapper carries the sheen overlay.
- Coverless label: Surco brand colors — `var(--color-accent)` fill with the
  `Music` icon in `var(--color-on-accent)` — instead of the panel gray.
- Cover label: unchanged image, plus a thin dark ring seating it on the disc.

### Iteration 3 (same day, flat design)

- The app is flat design: the static specular sheen overlay and the radial
  depth shading are removed — the disc is a solid near-black circle with flat
  groove rings. Coverless label also dropped its `Music` icon (plain accent
  circle, spindle dot only).
- Rotation stays visible via the conic wedges on the rotating disc: flat tonal
  segments (5–7% white) that sweep as it turns. Without them a coverless disc
  is radially symmetric and spinning changes no pixel.

## Motion

- CSS keyframe `vinyl-spin`, linear, infinite, ~4s per revolution (real 33⅓rpm
  is 1.8s; too twitchy at 40px).
- Spins only while audibly playing: when `paused` or `loading`, the animation
  freezes in place via `animation-play-state: paused` — like a real record, it
  does not reset to 0°.
- `prefers-reduced-motion: reduce` disables the spin entirely, following the
  existing `player-marquee` pattern in `index.css`.

## Implementation

Pure CSS/DOM (option A of the brainstorm): the disc is a circular wrapper div
with the gradients, containing the clipped cover `<img>` (or placeholder) —
all inside `Player.tsx`, plus one keyframe block in `index.css`.

Rejected: inline SVG (more code, same result at 40px) and pregenerated
assets/canvas (needless complexity).

## Contract

- `data-testid="player-cover"` and `data-testid="player-cover-placeholder"`
  keep their names; `player-cover` keeps exposing the `src` attribute.
  Existing tests in `Player.test.tsx` stay valid.
- New tests: the disc spins while playing, freezes when paused or loading, and
  the placeholder also renders as a disc.

## Out of scope

Any other player layout change; covers elsewhere (track list, editor).
