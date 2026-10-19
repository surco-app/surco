import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CueSummary } from '../../../shared/types'
import { CUE_COLOR } from '../lib/cueWave'

export function CueSwatches({
  summary,
  pending,
}: {
  summary: CueSummary
  pending: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <span
      data-testid="track-cue-swatches"
      data-pending={pending ? 'true' : undefined}
      className="flex shrink-0 items-center gap-0.5 text-[10px] text-fg-faint"
    >
      {!summary.analysed
        ? tr('trackList.cuesUnanalysed')
        : summary.hot.length === 0
          ? tr('trackList.cuesNone')
          : summary.hot.map((h) => (
              <span
                key={h.ms}
                data-testid="track-cue-swatch"
                aria-hidden="true"
                style={{
                  borderColor: CUE_COLOR[h.color ?? 1],
                  backgroundColor: pending ? 'transparent' : CUE_COLOR[h.color ?? 1],
                }}
                className="h-2 w-2 rounded-[2px] border"
              />
            ))}
    </span>
  )
}
