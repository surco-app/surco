import type React from 'react'

// The app icon is a record — concentric grooves around a label carrying the waveform — so
// the empty state turns it rather than showing it still: it's the same object the user just
// clicked in the Dock, and a platter that turns reads as ready rather than frozen. Drawn in
// outline at the muted greys the rest of the empty state uses, keeping the icon's blue for
// the label alone, so it weighs what an empty state should weigh and never reads as a logo
// dropped into the canvas.
export function EmptyDisc(): React.JSX.Element {
  return (
    <svg
      data-testid="empty-disc"
      aria-hidden="true"
      viewBox="0 0 1024 1024"
      className="h-32 w-32"
    >
      <defs>
        <radialGradient id="empty-disc-label-fill" cx="0.4" cy="0.34" r="0.9">
          <stop offset="0" stopColor="#CFE4FF" />
          <stop offset="0.6" stopColor="#9ED7FF" />
          <stop offset="1" stopColor="#6F9BEC" />
        </radialGradient>
      </defs>

      <g data-testid="empty-disc-platter" className="empty-disc-spin">
        <g fill="none" stroke="currentColor" strokeOpacity="0.32" strokeWidth="9">
          <circle cx="512" cy="512" r="292" />
          <circle cx="512" cy="512" r="252" />
          <circle cx="512" cy="512" r="212" />
        </g>
        {/* Load-bearing, not decoration: the grooves are perfectly concentric, so without an
            asymmetric mark the rotation is invisible — every frame looks the same. */}
        <path
          data-testid="empty-disc-mark"
          d="M 512 220 A 292 292 0 0 1 706 296"
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity="0.9"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </g>

      {/* Outside the spinning group: the label holds the waveform, and turning that would
          read as a loading spinner — exactly what an idle empty state must not claim. */}
      <g data-testid="empty-disc-label">
        <circle cx="512" cy="512" r="168" fill="url(#empty-disc-label-fill)" />
        <path
          d="M431 512 C 455 447, 479 447, 503 512 S 551 577, 575 512 L 593 512"
          fill="none"
          stroke="#0B1430"
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
