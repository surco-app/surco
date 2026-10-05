import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trimFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { TAIL_ENVELOPE, TRACK_ENVELOPE } from '../../lib/waveforms'
import { AppWave, EditorPanel, Glyph, ICONS } from './AppChrome'

// The track's length and the stretch of tail the Final pane shows, in seconds, so the
// end field and the summary move with the cut the way the app's do.
const TRACK_SECONDS = 403
const TAIL_SECONDS = 16.4
const HEAD = TRACK_ENVELOPE.slice(0, 40)

// The app's silence trim section: the Inicio and Final panes, with the cut sliding in
// from the end and settling onto the last beat.
export default function TrimScene() {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = trimFrame(useSceneProgress(ref, 4200))
  const trimmed = (1 - frame.cut) * TAIL_SECONDS

  return (
    <div ref={ref} className="h-full">
      <EditorPanel
        title={t('home.trim.section')}
        aside={
          trimmed > 0.05
            ? t('home.trim.summary', {
                seconds: trimmed.toLocaleString(i18n.language, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })
            : t('home.trim.none')
        }
      >
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Pane label={t('home.trim.start')} time="0.000">
            <AppWave values={HEAD} />
          </Pane>
          <Pane label={t('home.trim.end')} time={(TRACK_SECONDS - trimmed).toFixed(3)}>
            <span
              className="absolute inset-0"
              style={{ clipPath: `inset(0 ${(1 - frame.cut) * 100}% 0 0)` }}
            >
              <AppWave values={TAIL_ENVELOPE} />
            </span>
            <span
              className="absolute inset-0"
              style={{ clipPath: `inset(0 0 0 ${frame.cut * 100}%)` }}
            >
              <AppWave values={TAIL_ENVELOPE} className="fill-faint/35" />
            </span>
            <i
              className="absolute inset-y-0 block border-l border-dashed border-[#a9b1d6]"
              style={{ left: `${frame.cut * 100}%`, opacity: frame.cut < 0.999 ? 1 : 0 }}
            >
              <span
                className={`absolute top-1.5 -left-2.5 grid size-5 place-items-center rounded-full transition-colors duration-300 ${
                  frame.locked ? 'bg-blue text-bg' : 'bg-[#292e42] text-fg'
                }`}
              >
                <Glyph size={11}>{ICONS.scissors}</Glyph>
              </span>
            </i>
          </Pane>
        </div>
      </EditorPanel>
    </div>
  )
}

function Pane({
  label,
  time,
  children,
}: {
  label: string
  time: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {label}
        <span className="ml-auto rounded-md border border-[#737aa2]/45 bg-bg2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg tabular-nums">
          {time}
        </span>
      </p>
      <div className="relative mt-1.5 h-40 overflow-hidden rounded-md bg-bg2">{children}</div>
    </div>
  )
}
