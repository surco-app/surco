import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { HERO_ENVELOPE } from '../../lib/waveforms'
import { AppWave, EASE, EditorPanel, SceneCursor, Segmented } from './AppChrome'

// What the editor measured for the track: integrated loudness and true peak.
const LUFS = -9.7
const PEAK = 0.9

// The app's volume matching section: "Volume" chosen on the Streaming -14 preset, the
// preview waveform settling under the original, and the editor's own explanation of
// what will happen to the track once it has.
export default function NormalizeScene() {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const volume = useRef<HTMLSpanElement>(null)
  const [target] = useState(() => volume)
  const frame = normalizeFrame(useSceneProgress(ref, 5500))
  const on = frame.mode === 'volume'
  const num = (v: number) =>
    v.toLocaleString(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  return (
    <div ref={ref} className="h-full">
      <EditorPanel panelRef={panel} title={t('home.normalize.section')}>
        <Segmented
          options={[t('home.normalize.none'), t('home.normalize.volume'), t('home.normalize.peak')]}
          active={on ? 1 : 0}
          refs={{ 1: volume }}
        />
        <div
          className="mt-2 flex w-fit max-w-full flex-wrap rounded-[9px] border border-line p-0.5 text-xs transition-opacity duration-300"
          style={{ opacity: on ? 1 : 0 }}
        >
          {['Streaming −14', 'Club −9', 'Broadcast −23'].map((preset, i) => (
            <span
              key={preset}
              className={`rounded-[7px] px-2 py-1 whitespace-nowrap ${i === 0 ? 'bg-[#292e42] text-fg' : 'text-[#a9b1d6]'}`}
            >
              {preset}
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
          <i className="block size-1.5 rounded-full bg-faint" />
          {t('home.normalize.original', { lufs: num(LUFS), peak: num(PEAK) })}
        </p>
        <p
          className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted transition-opacity duration-300"
          style={{ opacity: on ? 1 : 0 }}
        >
          <i className="block size-1.5 rounded-full bg-blue" />
          {t('home.normalize.preview', {
            lufs: num(LUFS + frame.gain),
            peak: num(PEAK + frame.gain),
          })}
          <span className="rounded bg-[#292e42] px-1.5 py-px text-[10.5px] font-semibold text-fg tabular-nums">
            {num(frame.gain)} dB
          </span>
        </p>
        <div className="relative mt-1.5 h-24 overflow-hidden rounded-md bg-bg2">
          <AppWave values={HERO_ENVELOPE} className="fill-faint/45" />
          {on && <AppWave values={HERO_ENVELOPE} scale={10 ** (frame.gain / 20)} />}
        </div>
        <p
          className="mt-2.5 min-h-8 text-xs leading-snug text-pretty text-muted"
          style={{
            opacity: frame.explained ? 1 : 0,
            transform: frame.explained ? 'none' : 'translateY(4px)',
            transition: `opacity 0.3s ease, transform 0.4s ${EASE}`,
          }}
        >
          {t('home.normalize.explain', { gain: num(frame.gain), target: num(LUFS + frame.gain) })}
        </p>
        <SceneCursor container={panel} target={frame.cursor ? target : null} />
      </EditorPanel>
    </div>
  )
}
