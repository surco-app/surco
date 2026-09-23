import type React from 'react'

// The one pill a section header wears — every status the header shows routes through
// here so colour means the SAME thing everywhere. The tone is the severity of what the
// pill reports, never decoration:
//   · neutral — a measured figure or plain status fact (a loudness reading, a click
//     estimate, a detected cut, "not in your library"). Grey, quiet: readable without
//     opening the section, but it isn't asking for anything.
//   · accent  — the ACTIVE setting, shown only while the section is folded (open, the
//     control right below says the same thing, so the badge would be the second telling).
//   · good    — a genuine positive: audio quality is clean, or the track is already in
//     the library it is headed for. Reserved for a real "you're good", so green never
//     cries wolf.
//   · warn    — a verdict that wants a look before converting (quality "Review").
//   · danger  — a problem verdict (a fake-lossless transcode).
//
// Keeping all five in one primitive is what stops the header pills drifting into four
// hand-rolled colour treatments where a plain fact shouts as loud as a warning. The
// testid stays a prop so every existing selector keeps working.
//
// Drawn as a status line, not a filled capsule: a small dot in the tone's colour and the
// words beside it, the way macOS lists mark a state. The tinted backgrounds turned every
// header into a row of chips competing with the real controls around them. Neutral carries
// no dot, since a measured figure has no severity to mark; warn and danger also colour
// their words, so a problem still reads before the eye finds the dot.
const DOTS = {
  accent: 'bg-[var(--color-accent)]',
  neutral: '',
  good: 'bg-[var(--color-good)]',
  warn: 'bg-[var(--color-warn)]',
  danger: 'bg-[var(--color-danger)]',
} as const

const TEXT = {
  accent: 'text-fg-muted',
  neutral: 'text-fg-dim',
  good: 'text-fg-muted',
  warn: 'text-[var(--color-warn)]',
  danger: 'text-[var(--color-danger)]',
} as const

const ICON = {
  accent: 'text-[var(--color-accent)]',
  neutral: 'text-fg-dim',
  good: 'text-[var(--color-good)]',
  warn: 'text-[var(--color-warn)]',
  danger: 'text-[var(--color-danger)]',
} as const

export function SectionPill({
  tone,
  testid,
  numeric = false,
  icon,
  children,
}: {
  tone: keyof typeof DOTS
  testid: string
  // Figures line up column-wise as they tick (a loudness readout, a BPM) instead of
  // shuffling their own width.
  numeric?: boolean
  // A leading glyph that carries the pill's subject in place of the dot, coloured by the
  // tone — the tone still means severity, the icon means what it's about.
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${TEXT[tone]} ${
        numeric ? 'tabular-nums' : ''
      }`}
    >
      {icon ? (
        <span className={`flex ${ICON[tone]}`}>{icon}</span>
      ) : (
        tone !== 'neutral' && (
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} />
        )
      )}
      {children}
    </span>
  )
}
