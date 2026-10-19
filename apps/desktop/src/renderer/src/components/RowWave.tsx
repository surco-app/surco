import type React from 'react'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOT_CUE_DEFAULT_COLOR,
  hotCueColor,
  MEMORY_CUE_COLOR,
} from '../../../shared/rekordboxCueColors'
import type { RowCue, RowWaveRequest } from '../../../shared/types'
import { cueLetter } from '../lib/rowCues'
import { rowWaveKey, rowWaveOf, subscribeRowWave } from '../lib/rowWaves'

const WAVE_HEIGHT = 20

function wavePath(bars: number[]): string {
  return bars
    .map((v, i) => {
      const h = Math.max(1, v * WAVE_HEIGHT)
      return `M${i} ${(WAVE_HEIGHT - h) / 2}h0.7v${h}h-0.7Z`
    })
    .join('')
}

export function RowWave({
  request,
  cues,
  durationSec,
  pending,
  active,
}: {
  request: RowWaveRequest
  cues: RowCue[]
  durationSec: number | undefined
  pending: boolean
  active: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const key = rowWaveKey(request)
  const { path, analysisPath } = request
  const subscribe = useCallback(
    (listener: () => void) =>
      active ? subscribeRowWave({ path, analysisPath }, listener) : () => {},
    [path, analysisPath, active],
  )
  const bars = useSyncExternalStore(subscribe, () => rowWaveOf(key))
  const span = durationSec && durationSec > 0 ? durationSec * 1000 : 0
  const placed =
    span > 0
      ? cues
          .filter((c) => c.ms >= 0 && c.ms <= span)
          .map((c) => ({ ...c, at: (c.ms / span) * 100 }))
      : []
  const hot = placed.filter((c) => c.kind !== 0)
  const memory = placed.filter(
    (c, i) => c.kind === 0 && placed.findIndex((o) => o.kind === 0 && o.ms === c.ms) === i,
  )
  const awaiting = pending && hot.length === 0
  let label: string | undefined
  if (hot.length > 0) {
    label = tr(pending ? 'trackList.cuesAriaPending' : 'trackList.cuesAria', { count: hot.length })
  } else if (awaiting) {
    label = tr('trackList.cuesPendingNone')
  }
  return (
    <span
      data-testid="track-wave"
      data-pending={pending || undefined}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative block h-full"
    >
      {bars && bars.length > 0 && (
        <svg
          data-testid="track-wave-bars"
          aria-hidden="true"
          viewBox={`0 0 ${bars.length} ${WAVE_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-[18px] w-full fill-[var(--color-accent)] opacity-70"
        >
          <path d={wavePath(bars)} />
        </svg>
      )}
      {memory.map((c) => (
        <span
          key={`m-${c.ms}`}
          data-testid="track-memory-cue"
          aria-hidden="true"
          style={{ left: `calc(${c.at}% - 4px)`, borderTopColor: MEMORY_CUE_COLOR }}
          className="absolute top-0.5 h-0 w-0 border-x-4 border-t-[6px] border-x-transparent"
        />
      ))}
      {awaiting && (
        <span
          data-testid="track-cue-pending"
          aria-hidden="true"
          style={{ left: 'calc(0% - 6px)', borderColor: HOT_CUE_DEFAULT_COLOR }}
          className="absolute top-0 h-3 w-3 rounded-[3px] border"
        />
      )}
      {hot.map((c) => {
        const colour = hotCueColor(c.color)
        return (
          <span
            key={`h-${c.kind}-${c.ms}`}
            data-testid="track-hot-cue"
            aria-hidden="true"
            style={
              pending
                ? { left: `calc(${c.at}% - 6px)`, borderColor: colour, color: colour }
                : { left: `calc(${c.at}% - 6px)`, backgroundColor: colour, color: '#000' }
            }
            className={`absolute top-0 h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3 ${
              pending ? 'border' : ''
            }`}
          >
            {cueLetter(c.kind)}
          </span>
        )
      })}
    </span>
  )
}
