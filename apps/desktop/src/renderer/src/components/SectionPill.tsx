import type React from 'react'

// The one pill a section header wears — every status the header shows routes through
// here so colour means the SAME thing everywhere. The tone is the severity of what the
// pill reports, never decoration:
//   · neutral — a measured figure or plain status fact (a loudness reading, a click
//     estimate, a detected cut, "not in your library"). Grey, quiet: readable without
//     opening the section, but it isn't asking for anything.
//   · accent  — the ACTIVE setting, shown only while the section is folded (open, the
//     control right below says the same thing, so the badge would be the second telling).
//   · good    — a genuine positive VERDICT (audio quality is clean). Reserved for a real
//     "you're good" — status facts are neutral, so green never cries wolf.
//   · warn    — a verdict that wants a look before converting (quality "Review").
//   · danger  — a problem verdict (a fake-lossless transcode).
//
// Keeping all five in one primitive is what stops the header pills drifting into four
// hand-rolled colour treatments where a plain fact shouts as loud as a warning. The
// testid stays a prop so every existing selector keeps working.
const TONES = {
  accent: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  neutral: 'bg-[var(--color-panel-2)] text-fg-muted',
  good: 'bg-[var(--color-good)]/15 text-[var(--color-good)]',
  warn: 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]',
  danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]',
} as const

export function SectionPill({
  tone,
  testid,
  numeric = false,
  icon,
  children,
}: {
  tone: keyof typeof TONES
  testid: string
  // Figures line up column-wise as they tick (a loudness readout, a BPM) instead of
  // shuffling their own width.
  numeric?: boolean
  // A leading glyph (the Apple Music disc) that carries the pill's subject without a
  // second colour — the tone still means severity, the icon means what it's about.
  icon?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]} ${
        numeric ? 'tabular-nums' : ''
      }`}
    >
      {icon}
      {children}
    </span>
  )
}
