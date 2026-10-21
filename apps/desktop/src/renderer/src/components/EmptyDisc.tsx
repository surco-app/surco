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
//
// The app icon is a record, so the empty state shows the same object the user just clicked
// in the Dock. It does NOT turn: a platter rotating forever reads as a progress indicator,
// which is the one thing an idle screen must not claim. Instead the sound leaves the disc —
// rings pulsing outward from the rim while the record itself sits still. The disc keeps the
// icon's own materials (the blue face, its lit edge, the pale label with the waveform) so it
// reads as Surco's record rather than a generic vinyl glyph, drawn in the Tokyo Night
// colours closest to the icon's.
export function EmptyDisc(): React.JSX.Element {
  return (
    <svg
      data-testid="empty-disc"
      aria-hidden="true"
      viewBox="0 0 1024 1024"
      className="empty-disc-in h-20 w-20"
    >
      <defs>
        <radialGradient id="empty-disc-face" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#3d59a1" />
          <stop offset="0.6" stopColor="#2959aa" />
          <stop offset="1" stopColor="#283457" />
        </radialGradient>
        <linearGradient id="empty-disc-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7aa2f7" />
          <stop offset="0.5" stopColor="#3d59a1" stopOpacity="0.6" />
          <stop offset="1" stopColor="#283457" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="empty-disc-label-fill" cx="0.4" cy="0.34" r="0.9">
          <stop offset="0" stopColor="#89ddff" />
          <stop offset="1" stopColor="#7aa2f7" />
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
        <circle cx="512" cy="512" r="370" fill="url(#empty-disc-face)" />
        {/* The icon's edge, 10 wide on a 1024px Dock tile, would scale to 12 and land under a
            pixel at the 80px this renders at; 14 keeps it at about one. */}
        <circle
          cx="512"
          cy="512"
          r="363"
          fill="none"
          stroke="url(#empty-disc-rim)"
          strokeWidth="14"
        />
      </g>

      <g data-testid="empty-disc-label">
        <circle cx="512" cy="512" r="185" fill="url(#empty-disc-label-fill)" />
        <path
          d="M402 512 C 434 423, 468 423, 500 512 S 565 601, 597 512 L 622 512"
          fill="none"
          stroke="#0c0e14"
          strokeWidth="24"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
