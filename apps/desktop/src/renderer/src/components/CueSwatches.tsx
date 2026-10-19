import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueSummary } from '../../../shared/types'
import { CUE_COLOR } from '../lib/cueWave'

const UNKNOWN_CUE_COLOR = 'var(--color-fg-faint)'

export function CueSwatches({
  summary,
  pending,
}: {
  summary: CueSummary
  pending: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const count = summary.hot.length
  const waitingEmpty = summary.analysed && count === 0 && pending
  const label = waitingEmpty
    ? tr('trackList.cuesPendingNone')
    : count > 0
      ? tr(pending ? 'trackList.cuesAriaPending' : 'trackList.cuesAria', { count })
      : tr(summary.analysed ? 'trackList.cuesNone' : 'trackList.cuesUnanalysed')
  return (
    <span
      data-testid="track-cue-swatches"
      data-pending={pending ? 'true' : undefined}
      role="img"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 text-[10px] text-fg-faint"
    >
      {!summary.analysed ? (
        tr('trackList.cuesUnanalysed')
      ) : waitingEmpty ? (
        <span
          data-testid="track-cue-pending"
          aria-hidden="true"
          style={{ borderColor: UNKNOWN_CUE_COLOR }}
          className="h-2 w-2 rounded-[2px] border"
        />
      ) : count === 0 ? (
        tr('trackList.cuesNone')
      ) : (
        summary.hot.map((h, i) => {
          const color = CUE_COLOR[h.color ?? 1] ?? UNKNOWN_CUE_COLOR
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: cues at the same ms need the index to stay distinct
              key={`${h.ms}-${i}`}
              data-testid="track-cue-swatch"
              aria-hidden="true"
              style={{ borderColor: color, backgroundColor: pending ? 'transparent' : color }}
              className="h-2 w-2 rounded-[2px] border"
            />
          )
        })
      )}
    </span>
  )
}
