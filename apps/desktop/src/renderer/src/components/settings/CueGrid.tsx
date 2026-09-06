import type React from 'react'
import { useTranslation } from 'react-i18next'

// Milliseconds are meaningless until you see them against a beat. At the 128 BPM the BPM
// field itself suggests, a beat runs 469 ms — so the 51 ms a DJ might dial in is 11% of
// one. Framing a single beat across the panel makes that 49 px and plainly visible; four
// beats would shrink it to 12 px, which is the same as not drawing it at all.
const REFERENCE_BPM = 128
const MS_PER_BEAT = 60000 / REFERENCE_BPM

// One bar across the drawing. Measured against the alternatives at this width: two beats
// makes the displacement biggest (24 px) but leaves only three grid lines, which does not
// read as a grid at all; eight beats gives a convincing grid and shrinks 51 ms to 6 px,
// too small to see. Four beats is the balance — five lines, a bar a DJ recognises at a
// glance, and 12 px of displacement, small but legible beside the dotted origin.
const BEATS = 4
const SPAN_MS = MS_PER_BEAT * BEATS

const W = 447
const H = 76
// The beat the cue belongs to sits left of centre, leaving room for the displacement to
// run either way without the marker ever leaving the frame.
const ORIGIN_X = W * 0.42
const PX_PER_MS = W / SPAN_MS

// Past this the drawing would stop being informative — the cue would sit closer to the
// next beat than its own, which is a different problem than the one being tuned.
const MAX_DRAWN_MS = MS_PER_BEAT / 2

// Derived, not hand-listed: at this width only a couple of beats fit, and a fixed list
// put four of six lines outside the frame — leaving one lonely line and nothing to read
// the cue against. One extra beat past each edge keeps the grid running off both sides
// instead of appearing to start and stop inside the drawing.
const BEATS_LEFT = Math.ceil(ORIGIN_X / (MS_PER_BEAT * PX_PER_MS)) + 1
const BEATS_RIGHT = Math.ceil((W - ORIGIN_X) / (MS_PER_BEAT * PX_PER_MS)) + 1
const GRID_BEATS = Array.from({ length: BEATS_LEFT + BEATS_RIGHT + 1 }, (_, i) => i - BEATS_LEFT)

interface Props {
  offsetMs: number
}

// The grid and the cue on it: the two things Surco actually knows here. Deliberately no
// waveform — Surco cannot know where the transient of this DJ's track falls, and drawing
// a hit would suggest the cue is being aligned to real audio instead of to the grid.
export function CueGrid({ offsetMs }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const ms = Number.isFinite(offsetMs) ? offsetMs : 0
  // A negative offset delays the cue (see cueShiftFor, which subtracts it), and later is
  // further right on a timeline — so the sign carries straight into the x axis.
  const drawnMs = Math.max(-MAX_DRAWN_MS, Math.min(MAX_DRAWN_MS, -ms))
  const cueX = ORIGIN_X + drawnMs * PX_PER_MS
  const moved = Math.abs(ms) > 0

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)]"
      role="img"
      aria-label={tr('settings.traktorCueGridAlt')}
    >
      <title>{tr('settings.traktorCueGridAlt')}</title>
      {GRID_BEATS.map((beat) => {
        const x = ORIGIN_X + beat * MS_PER_BEAT * PX_PER_MS
        return (
          <line
            key={beat}
            x1={x}
            x2={x}
            y1={10}
            y2={H - 10}
            stroke="var(--color-line-strong)"
            strokeWidth={beat === 0 ? 1.5 : 1}
          />
        )
      })}

      {/* Where the cue sat before the adjustment, so the direction reads without the
          user having to remember which way the minus sign goes. Dashed and dim: it is a
          reference, not a second cue. */}
      <line
        data-testid="cue-grid-origin"
        x1={ORIGIN_X}
        x2={ORIGIN_X}
        y1={8}
        y2={H - 8}
        stroke="var(--color-fg-dim)"
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={moved ? 0.8 : 0}
      />

      {moved && (
        <line
          x1={ORIGIN_X}
          x2={cueX}
          y1={H / 2}
          y2={H / 2}
          stroke="var(--color-accent)"
          strokeWidth={1}
        />
      )}

      <line
        data-testid="cue-grid-cue"
        x1={cueX}
        x2={cueX}
        y1={8}
        y2={H - 8}
        stroke="var(--color-accent)"
        strokeWidth={2}
      />
      <rect x={cueX - 4} y={6} width={8} height={8} rx={2} fill="var(--color-accent)" />
    </svg>
  )
}
