// A drawn sleeve, not a real one: the scene needs artwork to land for the step to
// read as "the release was applied", and a real cover would put commercial art in a
// public repo. Concentric rings and a centre label read as a record at 96px, which is
// all the size this ever gets.
export default function CoverArt({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      role="img"
      aria-label="Carátula del disco"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="sleeve" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2b3153" />
          <stop offset="55%" stopColor="#1f2335" />
          <stop offset="100%" stopColor="#16161e" />
        </linearGradient>
        <linearGradient id="label" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7aa2f7" />
          <stop offset="100%" stopColor="#bb9af7" />
        </linearGradient>
      </defs>

      <rect width="96" height="96" fill="url(#sleeve)" />

      {/* The record itself, off-centre so the sleeve reads as a sleeve. */}
      <circle cx="60" cy="46" r="33" fill="#0e0f17" />
      {[28, 24, 20, 16].map((r) => (
        <circle key={r} cx="60" cy="46" r={r} fill="none" stroke="#232842" strokeWidth="1" />
      ))}
      <circle cx="60" cy="46" r="11" fill="url(#label)" />
      <circle cx="60" cy="46" r="2" fill="#0e0f17" />

      {/* A sliver of sleeve type, at a size where it reads as text without being
          legible enough to impersonate a real release. */}
      <rect x="8" y="74" width="34" height="3" rx="1.5" fill="#7aa2f7" opacity="0.8" />
      <rect x="8" y="81" width="22" height="2.5" rx="1.25" fill="#828bb8" opacity="0.6" />
    </svg>
  )
}
