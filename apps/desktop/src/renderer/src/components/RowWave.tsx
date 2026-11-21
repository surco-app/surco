import type React from 'react'
import { useCallback, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { HOT_CUE_DEFAULT_COLOR, MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { RowCue, RowWaveRequest } from '../../../shared/types'
import { markStyle, placeCues } from '../lib/cueMarks'
import { PROGRESS_CREEP_MS, prefersReducedMotion, standardEasing } from '../lib/motion'
import { rowWaveKey, rowWaveOf, subscribeRowWave } from '../lib/rowWaves'
import { Tooltip } from './Tooltip'
import { WaveBars } from './WaveBars'

export function RowWave({
  request,
  cues,
  durationSec,
  pending,
  active,
  unanalyzed,
  proposals = [],
  progress,
}: {
  request: RowWaveRequest
  cues: RowCue[]
  durationSec: number | undefined
  pending: boolean
  active: boolean
  unanalyzed?: 'rekordbox' | 'engine'
  proposals?: number[]
  progress?: number
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
  const unanalyzedNote =
    unanalyzed &&
    tr(unanalyzed === 'engine' ? 'trackList.engineUnanalyzed' : 'trackList.rekordboxUnanalyzed')
  // Cues on a track the library has not analysed were set in Surco's editor, which measured
  // the wave to place them: the row draws that wave under them like any other, in faint ink
  // since it is Surco's and not the library's, with a dashed ring for what is missing. The
  // dashed baseline stays only while there is nothing to draw over it.
  const provisional = !!unanalyzed && (hot.length > 0 || calls.length > 0)
  const drawable = (!unanalyzed || provisional) && !!bars && bars.length > 0
  const waveClass = 'absolute inset-x-0 bottom-0 h-[18px] w-full compact:h-[13px]'
  const waveFill = provisional ? 'var(--color-fg-faint)' : undefined
  const fillRef = useRef<HTMLSpanElement>(null)
  const running = useRef<Animation | null>(null)
  const sheenId = `sheen-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  useLayoutEffect(() => () => running.current?.cancel(), [])
  useLayoutEffect(() => {
    const el = fillRef.current
    if (progress === undefined || !el || typeof el.animate !== 'function' || prefersReducedMotion())
      return
    const from = getComputedStyle(el).clipPath
    running.current?.cancel()
    running.current = el.animate(
      [{ clipPath: from }, { clipPath: clipTo(progress + (1 - progress) / 3) }],
      { duration: PROGRESS_CREEP_MS, easing: standardEasing(), fill: 'forwards' },
    )
  }, [progress])
  const labels: string[] = []
  if (hot.length > 0)
    labels.push(
      tr(pending ? 'trackList.cuesAriaPending' : 'trackList.cuesAria', { count: hot.length }),
    )
  else if (awaiting) labels.push(tr('trackList.cuesPendingNone'))
  if (unanalyzedNote) labels.push(unanalyzedNote)
  const label = labels.length > 0 ? labels.join('. ') : undefined
  return (
    <span
      data-testid="track-wave"
      data-pending={pending || undefined}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="flex h-full items-center gap-1.5"
    >
      <span className="relative block h-full min-w-0 flex-1">
        {unanalyzed && !provisional && progress === undefined && (
          <span
            data-testid="track-unanalyzed"
            className="absolute inset-x-0 top-1/2 block border-t border-dashed border-[var(--color-line-strong)]"
          />
        )}
        {drawable && (
          <WaveBars
            bars={bars}
            testId="track-wave-bars"
            className={waveClass}
            fill={waveFill}
            opacity={progress === undefined ? undefined : 0.25}
          />
        )}
        {progress !== undefined && !drawable && (
          <span className="absolute inset-x-0 bottom-2 h-0.5 rounded-full bg-[var(--color-accent)] opacity-25 compact:bottom-1.5" />
        )}
        {progress !== undefined && (
          <span
            ref={fillRef}
            data-testid="track-convert-fill"
            className="absolute inset-0"
            style={{ clipPath: clipTo(progress) }}
          >
            {drawable ? (
              <>
                <WaveBars
                  bars={bars}
                  testId="track-convert-bars"
                  className={waveClass}
                  fill={waveFill}
                />
                {!prefersReducedMotion() && (
                  <>
                    <svg aria-hidden="true" className="absolute h-0 w-0">
                      <linearGradient id={sheenId} x1="-0.3" x2="0">
                        <stop offset="0" stopColor="#fff" stopOpacity="0" />
                        <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
                        <stop offset="1" stopColor="#fff" stopOpacity="0" />
                        <animate
                          attributeName="x1"
                          values="-0.3;1"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="x2"
                          values="0;1.3"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                      </linearGradient>
                    </svg>
                    <WaveBars
                      bars={bars}
                      testId="track-convert-sheen"
                      className={waveClass}
                      fill={`url(#${sheenId})`}
                    />
                  </>
                )}
              </>
            ) : (
              <span className="absolute inset-x-0 bottom-2 h-0.5 rounded-full bg-[var(--color-accent)] compact:bottom-1.5" />
            )}
          </span>
        )}
        {span > 0 &&
          proposals.map((ms) => (
            <span
              key={`p-${ms}`}
              data-testid="track-wave-proposal"
              aria-hidden="true"
              style={{ left: `${(ms / span) * 100}%` }}
              className="absolute top-0 bottom-0 border-l border-dashed border-[var(--color-accent)]"
            />
          ))}
        {calls.map((c) => (
          <span
            key={`m-${c.key}`}
            data-testid="track-memory-cue"
            aria-hidden="true"
            style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR }}
            className="absolute h-0 w-0 border-x-4 border-t-[6px] border-x-transparent"
          />
        ))}
        {awaiting && (
          <span
            data-testid="track-cue-pending"
            aria-hidden="true"
            style={{ ...markStyle(0), borderColor: HOT_CUE_DEFAULT_COLOR }}
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
                  ? { ...markStyle(c.at), borderColor: colour, color: colour }
                  : { ...markStyle(c.at), backgroundColor: colour, color: '#000' }
              }
              className={`absolute h-3 w-3 rounded-[3px] text-center text-label font-semibold leading-3 ${
                pending ? 'border' : ''
              }`}
            >
              {c.letter}
            </span>
          )
        })}
      </span>
      {provisional && unanalyzedNote && (
        <span
          data-testid="track-unanalyzed-mark"
          className="group/dot relative h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-[var(--color-fg-faint)]"
        >
          <span className="absolute inset-[3px] rounded-full bg-[var(--color-fg-faint)] opacity-50" />
          <Tooltip label={unanalyzedNote} align="end" scope="dot" />
        </span>
      )}
    </span>
  )
}

function clipTo(progress: number): string {
  return `inset(0px ${Math.round((1 - progress) * 1000) / 10}% 0px 0px)`
}
