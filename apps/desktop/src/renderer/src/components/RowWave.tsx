import type React from 'react'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { HOT_CUE_DEFAULT_COLOR, MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { RowCue, RowWaveRequest } from '../../../shared/types'
import { markStyle, placeCues } from '../lib/cueMarks'
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
  const { hot, calls } = placeCues(
    cues.map((c, i) => ({ key: `${i}`, ...c })),
    span,
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
      {calls.map((c) => (
        <span
          key={`m-${c.key}`}
          data-testid="track-memory-cue"
          aria-hidden="true"
          style={{ ...markStyle(c.at, 'call', 'row'), borderTopColor: MEMORY_CUE_COLOR }}
          className="absolute h-0 w-0 border-x-4 border-t-[6px] border-x-transparent"
        />
      ))}
      {awaiting && (
        <span
          data-testid="track-cue-pending"
          aria-hidden="true"
          style={{ ...markStyle(0, 'hot', 'row'), borderColor: HOT_CUE_DEFAULT_COLOR }}
          className="absolute h-3 w-3 rounded-[3px] border"
        />
      )}
      {hot.map((c) => {
        const colour = c.colour
        return (
          <span
            key={`h-${c.key}`}
            data-testid="track-hot-cue"
            aria-hidden="true"
            style={
              pending
                ? { ...markStyle(c.at, 'hot', 'row'), borderColor: colour, color: colour }
                : { ...markStyle(c.at, 'hot', 'row'), backgroundColor: colour, color: '#000' }
            }
            className={`absolute h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3 ${
              pending ? 'border' : ''
            }`}
          >
            {c.letter}
          </span>
        )
      })}
    </span>
  )
}
