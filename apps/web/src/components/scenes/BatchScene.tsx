import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { batchFrame, BATCH_QUEUE, BATCH_TOTAL } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'
import TrackRows, { type Row } from './TrackRows'

const LIBRARY_DESTINATIONS = ['Apple Music', 'Engine DJ']
const EXPORT_DESTINATIONS = ['rekordbox', 'Traktor', 'Serato', 'M3U8']

// Kim Sanders keeps the red stripe the quality pass puts on a flagged track: the
// queue is also saying "this one has a problem", and a batch where every row sails
// through would drop that half of the story.
const FLAGGED = 'Kim Sanders — Ride'

// The queue converts track by track — amber ring while working, blue coin when done
// — and the destinations light only once there are files to send, which is the order
// the app really works in. The static version showed a queue already half converted
// with every destination lit, i.e. the end state of work nobody watched happen.
export default function BatchScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = batchFrame(useSceneProgress(ref, 6000))

  const rows: Row[] = BATCH_QUEUE.map((track, i) => {
    const state = frame.states[i]
    if (track.name === FLAGGED && state !== 'working') {
      return { name: track.name, state: 'flagged', format: track.format }
    }
    if (state === 'working') {
      return {
        name: track.name,
        state: 'working',
        stage: t('home.batch.stage'),
        progress: Math.round(frame.rowProgress * 100),
        selected: true,
      }
    }
    return { name: track.name, state, format: track.format }
  })

  // Owns its window chrome so the toolbar counter tracks the queue instead of
  // sitting frozen at "Converting 11/40".
  return (
    <AppFrame
      pill={
        frame.finished
          ? t('home.batch.pillDone', { total: BATCH_TOTAL })
          : t('home.batch.pillRunning', { done: frame.done, total: BATCH_TOTAL })
      }
      busy={!frame.finished}
      progress={(frame.done / BATCH_TOTAL) * 100}
    >
    <div ref={ref} className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <TrackRows rows={rows} />
      <div className="border-t border-line p-5 lg:border-t-0 lg:border-l">
        <div className="relative overflow-hidden rounded-lg bg-blue/20 px-3 py-2 font-mono text-[11px]">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-blue/30 transition-[width] duration-200 ease-linear"
            style={{ width: `${frame.fill * 100}%` }}
          />
          <span className="relative flex justify-between">
            <span className="text-fg">
              {frame.finished ? t('home.batch.ready') : t('home.batch.stage')}
            </span>
            <span className="text-faint">{t('home.batch.cancel')}</span>
          </span>
        </div>
        <p className="mt-4 font-mono text-[9px] tracking-wider text-faint uppercase">
          {t('home.batch.toLibrary')}
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {LIBRARY_DESTINATIONS.map((d, i) => (
            <span
              key={d}
              className={`rounded border px-2 py-1.5 text-center font-mono text-[11px] transition-colors duration-500 ${
                i < frame.destinationsLit
                  ? 'border-blue/45 bg-blue/10 text-blue'
                  : 'border-line text-muted'
              }`}
            >
              {d}
            </span>
          ))}
        </div>
        <p className="mt-3 font-mono text-[9px] tracking-wider text-faint uppercase">
          {t('home.batch.toFile')}
        </p>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {EXPORT_DESTINATIONS.map((d) => (
            <span
              key={d}
              className="rounded border border-line px-1.5 py-1 text-center font-mono text-[9px] text-muted"
            >
              {d}
            </span>
          ))}
        </div>
        <p className="mt-5 font-mono text-[11px] text-green">{t('home.batch.cues')}</p>
        <p className="mt-2 min-h-4 font-mono text-[11px] text-faint">
          {frame.finished ? t('home.batch.summary') : ''}
        </p>
      </div>
    </div>
    </AppFrame>
  )
}
