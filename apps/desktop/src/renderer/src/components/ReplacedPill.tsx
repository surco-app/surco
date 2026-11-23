import { CircleAlert, CircleCheck } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { ReplaceShift } from '../../../shared/replaceShift'
import { shiftLabel } from '../lib/toReview'

// Shaped like the cue section's other marks (the provisional grid's chip), so a replaced
// track reads as one more state of the section. The shift stays in ms, untranslated: it is
// the measured audio offset, a figure, and its sign says which way the cues went.
export function ReplacedPill({ shift }: { shift: ReplaceShift }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const moved = 'moved' in shift
  return (
    <span
      data-testid="cues-replaced-pill"
      data-state={moved ? 'moved' : 'unmoved'}
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-label font-semibold tabular-nums ${
        moved
          ? 'bg-[color-mix(in_srgb,var(--color-good)_14%,transparent)] text-good'
          : 'bg-[color-mix(in_srgb,var(--color-warn)_14%,transparent)] text-warn'
      }`}
    >
      {moved ? (
        <CircleCheck className="h-3 w-3" aria-hidden="true" />
      ) : (
        <CircleAlert className="h-3 w-3" aria-hidden="true" />
      )}
      {moved ? shiftLabel(shift.moved) : tr('editor.cues.replaced.notMoved')}
    </span>
  )
}

// Only an amber pill needs a why: the DJ checks those cues by ear, and the sentence says
// what Surco could not do without guessing at figures it never measured.
export function ReplacedReason({ shift }: { shift: ReplaceShift }): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if ('moved' in shift) return null
  return (
    <p data-testid="cues-replaced-reason" className="text-xs text-fg-dim">
      {tr(`editor.cues.replaced.${shift.unmoved}`)}
    </p>
  )
}
