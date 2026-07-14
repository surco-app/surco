import type React from 'react'

// The pills a section header wears. Two of them, by convention:
//   · accent — the ACTIVE setting, shown only while the section is folded (open, the control
//     right below says the same thing, so the badge would be the second telling).
//   · neutral — a MEASURED fact (a loudness reading, a click estimate, a detected cut). The
//     app's one convention for analysis results: readable without opening the section.
//   · warn — a measurement that wants a look (a coin-flip beatgrid).
//
// Hand-rolled in four sections with the same class string copy-pasted each time, and the
// RX-style sections still to come (de-clip, rumble, crackle) would each have copied it
// again. The testid stays a prop so every existing selector keeps working.
const TONES = {
  accent: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  neutral: 'bg-[var(--color-panel-2)] text-fg-muted',
  warn: 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]',
} as const

export function SectionPill({
  tone,
  testid,
  numeric = false,
  children,
}: {
  tone: keyof typeof TONES
  testid: string
  // Figures line up column-wise as they tick (a loudness readout, a BPM) instead of
  // shuffling their own width.
  numeric?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]} ${
        numeric ? 'tabular-nums' : ''
      }`}
    >
      {children}
    </span>
  )
}
