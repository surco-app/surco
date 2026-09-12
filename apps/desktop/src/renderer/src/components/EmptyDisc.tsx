import type React from 'react'

// The rings leave one after another rather than together: three at the same delay stack
// into one thicker ring and the pulse reads as a blink. A third of the cycle apart is far
// enough that the eye reads three separate departures.
const RING_DELAYS = ['0s', '0.87s', '1.74s']

// Every radius here is the icon's own, scaled by 1.233. The icon sits at r=300 in a 1024
// viewBox because a Dock tile has to leave macOS its rounded-square margin; borrowed
// unchanged that margin is dead space, and the disc rendered 75px wide inside a 128px box.
// 370 is the ceiling: the outermost ring reaches r*1.34 + half its 10-wide stroke, which at
// 370 lands on 501 and still clears the 512 edge, so the pulse never clips.

// The app icon is a record, so the empty state shows the same object the user just clicked
// in the Dock. It does NOT turn: a platter rotating forever reads as a progress indicator,
// which is the one thing an idle screen must not claim. Instead the sound leaves the disc —
// rings pulsing outward from the rim while the record itself sits still. The disc keeps the
// icon's own materials (the rim, the groove rings, the blue label with the waveform) so it
// reads as Surco's record rather than a generic vinyl glyph.
export function EmptyDisc(): React.JSX.Element {
  return (
    <svg
      data-testid="empty-disc"
      aria-hidden="true"
      viewBox="0 0 1024 1024"
      className="empty-disc-in h-32 w-32"
    >
      <defs>
        <radialGradient id="empty-disc-face" cx="0.42" cy="0.36" r="0.85">
          <stop offset="0" stopColor="#23263A" />
          <stop offset="0.55" stopColor="#131520" />
          <stop offset="1" stopColor="#07080C" />
        </radialGradient>
        <radialGradient id="empty-disc-label-fill" cx="0.4" cy="0.34" r="0.9">
          <stop offset="0" stopColor="#CFE4FF" />
          <stop offset="0.6" stopColor="#9ED7FF" />
          <stop offset="1" stopColor="#6F9BEC" />
        </radialGradient>
      </defs>

      {/* Behind the disc, so a ring is born at the rim and grows away from it rather than
          crossing the face on its way out. */}
      {RING_DELAYS.map((delay) => (
        <circle
          key={delay}
          data-testid="empty-disc-ring"
          className="empty-disc-ping"
          style={{ animationDelay: delay }}
          cx="512"
          cy="512"
          r="370"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="10"
        />
      ))}

      <g data-testid="empty-disc-platter">
        <circle cx="512" cy="512" r="370" fill="#3A4060" />
        <circle cx="512" cy="512" r="363" fill="url(#empty-disc-face)" />
        {/* The icon draws these at 0.06 opacity and 3 wide, tuned for a 1024px Dock tile. At
            the 128px this renders at they vanish, so both are lifted to survive the size. */}
        <g fill="none" stroke="#FFFFFF" strokeOpacity="0.08" strokeWidth="5">
          <circle cx="512" cy="512" r="331" />
          <circle cx="512" cy="512" r="301" />
          <circle cx="512" cy="512" r="271" />
          <circle cx="512" cy="512" r="242" />
        </g>
      </g>

      <g data-testid="empty-disc-label">
        <circle cx="512" cy="512" r="168" fill="url(#empty-disc-label-fill)" />
        <path
          d="M412 512 C 442 432, 471 432, 501 512 S 560 592, 590 512 L 612 512"
          fill="none"
          stroke="#0B1430"
          strokeWidth="20"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
