// A drawn sleeve for the release the scene applies — Ken Laszlo, "When I Fall In
// Love", Factory Team 1995. Drawn rather than photographed: real cover art in a
// public GPL repo is someone else's, and the previous generic record-and-rings read
// as a placeholder icon in both places it appears rather than as one specific record.
//
// The composition is the genre's own: a cold blue field, a narrow figure panel down
// the right, condensed caps for the artist and a white band carrying the title. It
// has to survive being drawn at 28px in the results row as well as 72px in the
// applied panel, so every element is a solid block — hairlines vanish at the small
// size, and stroke widths that read at 72 disappear at 28.
export default function CoverArt({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      role="img"
      aria-label="Carátula: Ken Laszlo, When I Fall In Love"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="cover-field" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#b9d3e8" />
          <stop offset="45%" stopColor="#8fb2cf" />
          <stop offset="100%" stopColor="#6b8fae" />
        </linearGradient>
        <linearGradient id="cover-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3f2f52" />
          <stop offset="40%" stopColor="#6a4a7a" />
          <stop offset="100%" stopColor="#2c3a52" />
        </linearGradient>
        <linearGradient id="cover-figure" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fd6a8" />
          <stop offset="55%" stopColor="#4d9b8f" />
          <stop offset="100%" stopColor="#3b5c73" />
        </linearGradient>
      </defs>

      <rect width="96" height="96" fill="url(#cover-field)" />

      {/* The figure panel down the right — the sleeve's one warm element against an
          otherwise cold field. */}
      <rect x="62" y="6" width="28" height="84" fill="url(#cover-panel)" />
      <path d="M76 30c5 0 8 4 8 9v51H68V39c0-5 3-9 8-9Z" fill="url(#cover-figure)" opacity="0.85" />
      <circle cx="76" cy="24" r="7" fill="url(#cover-figure)" opacity="0.85" />

      {/* KEN LASZLO, condensed caps. Blocks rather than glyphs: at 28px real text is
          unreadable mush, while bars at these proportions still read as a name. */}
      <g fill="#243349">
        <rect x="8" y="34" width="7" height="9" />
        <rect x="17" y="34" width="7" height="9" />
        <rect x="26" y="34" width="7" height="9" />
        <rect x="38" y="34" width="7" height="9" />
        <rect x="47" y="34" width="7" height="9" />
      </g>
      <g fill="#243349" opacity="0.9">
        <rect x="8" y="46" width="6" height="8" />
        <rect x="16" y="46" width="6" height="8" />
        <rect x="24" y="46" width="6" height="8" />
        <rect x="32" y="46" width="6" height="8" />
        <rect x="40" y="46" width="6" height="8" />
        <rect x="48" y="46" width="6" height="8" />
      </g>

      {/* The white title band, the sleeve's strongest horizontal. */}
      <rect x="4" y="62" width="58" height="13" fill="#f2f6fa" />
      <g fill="#4a5f7a">
        <rect x="8" y="67" width="12" height="3" />
        <rect x="22" y="67" width="4" height="3" />
        <rect x="28" y="67" width="9" height="3" />
        <rect x="39" y="67" width="4" height="3" />
        <rect x="45" y="67" width="13" height="3" />
      </g>
    </svg>
  )
}
