import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUES_FLOW,
  GRID_DRIFT_MS,
  GRID_ENVELOPE,
  GRID_SECONDS,
  GRID_TRACK,
  GRID_WINDOW,
  gridFrame,
} from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { AppWave, Cover } from './AppChrome'

const at = (ms: number) =>
  `${((ms - GRID_WINDOW.from) / (GRID_WINDOW.to - GRID_WINDOW.from)) * 100}%`

const FILTERS = [
  { key: 'silence', count: 3 },
  { key: 'noCues', count: 41 },
] as const

export default function GridScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = gridFrame(useSceneProgress(ref, GRID_SECONDS * 1000))
  const onBeat = frame.cueMs === 0

  return (
    <div ref={ref} data-testid="grid-scene" className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <ul
        aria-hidden="true"
        className="self-start rounded-xl border border-line bg-bg p-1.5 text-left text-[13px]"
      >
        {FILTERS.map(({ key, count }) => (
          <li key={key} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-muted">
            <span className="flex-1">{t(`home.cues.grid.filters.${key}`)}</span>
            <span className="text-faint tabular-nums">{count}</span>
          </li>
        ))}
        <li
          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-300 ${frame.selected ? 'bg-surface2 text-fg' : 'text-muted'}`}
        >
          <span className="flex-1">{t('home.cues.grid.filters.offGrid')}</span>
          <i className="block size-1.5 rounded-full bg-amber" />
          <span className="text-faint tabular-nums">{frame.count}</span>
        </li>
      </ul>

      <div className="flex min-w-0 flex-col gap-4">
        <div
          aria-hidden="true"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-bg px-4 py-4 text-left sm:px-5"
        >
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
            <span className="flex min-w-48 flex-1 items-center gap-3">
              <span className="size-9 flex-none overflow-hidden rounded-md">
                <Cover src={GRID_TRACK.cover} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-fg">
                  {GRID_TRACK.title}
                </span>
                <span className="block truncate text-xs text-muted">{GRID_TRACK.artist}</span>
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span
                className="flex h-8 items-center rounded-lg border border-line bg-surface2 px-2.5 text-xs whitespace-nowrap text-fg transition-transform duration-200"
                style={{ transform: frame.clearPressed ? 'scale(0.96)' : 'none' }}
              >
                {t('home.cues.grid.clearAll')}
              </span>
              <span
                className="flex h-8 items-center gap-1.5 rounded-lg border border-blue px-2.5 text-xs font-semibold whitespace-nowrap text-blue transition-transform duration-200"
                style={{ transform: frame.autoPressed ? 'scale(0.96)' : 'none' }}
              >
                <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
                  <path
                    d="M8 1 9.6 6.4 15 8 9.6 9.6 8 15 6.4 9.6 1 8 6.4 6.4Z"
                    fill="currentColor"
                  />
                </svg>
                {t('home.cues.autoButton')}
              </span>
            </span>
          </div>

          <div className="relative h-36 overflow-hidden rounded-md bg-bg2">
            <span className="absolute inset-x-0 top-5 bottom-5">
              <AppWave values={GRID_ENVELOPE} />
            </span>
            <i
              className="absolute inset-y-0 block border-l border-dashed border-fg/50"
              style={{ left: at(0) }}
            />
            <span
              className="absolute top-0 bottom-0 block"
              style={{
                left: at(frame.cueMs ?? GRID_DRIFT_MS),
                opacity: frame.cueMs === null ? 0 : 1,
                transition: 'opacity 0.3s ease',
              }}
            >
              <i
                className="absolute inset-y-0 left-0 block w-0.5 -translate-x-1/2"
                style={{ backgroundColor: CUES_FLOW[0].colour }}
              />
              <i
                className="absolute top-0 left-0 block size-3.5 -translate-x-1/2 rounded-[3px] text-center text-[9px] leading-3.5 font-semibold text-bg not-italic"
                style={{ backgroundColor: CUES_FLOW[0].colour }}
              >
                A
              </i>
            </span>
          </div>

          <p
            className={`text-right font-mono text-xs transition-colors duration-300 ${onBeat ? 'text-muted' : 'text-amber'}`}
          >
            {onBeat
              ? t('home.cues.grid.hit')
              : t('home.cues.grid.miss', { ms: Math.abs(GRID_DRIFT_MS) })}
          </p>
        </div>

        <p className="text-left text-sm leading-relaxed text-pretty text-muted">
          <strong className="font-semibold text-fg">{t('home.cues.grid.title')}</strong>{' '}
          {t('home.cues.grid.text')}
        </p>
      </div>
    </div>
  )
}
