import { X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { LoudnessResult, NormalizeConfig } from '../../../shared/types'
import { formatDb, predictNormalized } from '../lib/quality'
import { Tooltip } from './Tooltip'

interface Props {
  normalize: NormalizeConfig
  loudness: LoudnessResult | null | undefined
  // Flips the SAME persisted setting as Settings > Editor's "Inline explanations":
  // the lever lives where the eyes are, the way back lives in Settings.
  onDismiss?: () => void
}

// The sentence the prediction was always able to say and never did. predictNormalized
// already knows whether this track's gained peaks would cross the ceiling (`limited`) —
// the exact fact a user emailed about after watching his files land sometimes ON the
// ceiling and sometimes under it. The figures live in the waveform legend below; this
// card owns the mechanism: constant gain, or gain plus the limiter holding the overs.
// Accent edge when the limiter will engage, the calm "good" edge when it will not.
export function NormalizePlan({ normalize, loudness, onDismiss }: Props): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const predicted = loudness ? predictNormalized(normalize, loudness) : null
  if (!loudness || !predicted) return null
  // The nominal gain is what the conversion applies in every branch — the limited one
  // applies it in full and then holds the overs — so the sentence can always name it,
  // even where gainDb is null because no single figure describes the loud passages.
  const gainDb = predicted.gainDb ?? predicted.lufs - loudness.integratedLufs
  const gain = `${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}`
  const kind = predicted.limited ? 'limited' : normalize.mode === 'peak' ? 'peak' : 'gain'
  const values = {
    gain,
    lufs: formatDb(predicted.lufs),
    peak: formatDb(predicted.truePeakDb),
  }
  return (
    <div
      data-testid="normalize-plan"
      data-plan={predicted.limited ? 'limited' : 'gain'}
      className={`mt-3 rounded-lg border border-[var(--color-line)] border-l-[3px] bg-[var(--color-field)] px-3 py-2.5 ${
        predicted.limited ? 'border-l-[var(--color-accent)]' : 'border-l-[var(--color-good)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-fg-dim">
          {tr('normalize.plan.head')}
        </p>
        {onDismiss && (
          <button
            type="button"
            data-testid="normalize-plan-dismiss"
            aria-label={tr('normalize.hideHints')}
            onClick={onDismiss}
            className="press group relative -mt-1 -mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <Tooltip label={tr('normalize.hideHints')} />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-fg tabular-nums">
        {tr(`normalize.plan.${kind}`, values)}
      </p>
      <p className="mt-0.5 text-[11px] text-fg-muted tabular-nums">
        {tr(`normalize.plan.${kind}Sub`, values)}
      </p>
    </div>
  )
}
