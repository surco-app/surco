import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { declickFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { DECLICK_ENVELOPE, DECLICK_MARKS } from '../../lib/waveforms'
import { AppWave, EASE, EditorPanel, Glyph, ICONS, SceneCursor, Segmented } from './AppChrome'

// The app's vinyl repair section: the clicks it found marked on the strip, "Standard"
// clicks and "Medium" background noise chosen in turn, and "Listen to the result"
// playing the repaired strip through.
export default function DeclickScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const standard = useRef<HTMLSpanElement>(null)
  const noise = useRef<HTMLSpanElement>(null)
  const listen = useRef<HTMLSpanElement>(null)
  const [targets] = useState(() => ({ standard, noise, listen }))
  const frame = declickFrame(useSceneProgress(ref, 6500))
  const on = frame.mode === 'standard'

  return (
    <div ref={ref} className="h-full">
      <EditorPanel
        panelRef={panel}
        title={t('home.declick.section')}
        aside={t('home.declick.count', { count: frame.marks })}
      >
        <p className="mt-2.5 text-[11.5px] text-muted">{t('home.declick.clicks')}</p>
        <Segmented
          options={[
            t('home.declick.off'),
            t('home.declick.soft'),
            t('home.declick.standard'),
            t('home.declick.strong'),
          ]}
          active={on ? 2 : 0}
          refs={{ 2: standard }}
        />
        <p className="mt-2.5 text-[11.5px] text-muted">{t('home.declick.found')}</p>
        <div className="relative mt-1.5 h-16 overflow-hidden rounded-md bg-bg2">
          <AppWave values={DECLICK_ENVELOPE} />
          {DECLICK_MARKS.map((m) => (
            <i
              key={m}
              className="absolute inset-y-0 block w-[3px] bg-amber/85"
              style={{ left: `${m * 100}%` }}
            />
          ))}
          <i
            className="absolute inset-y-0 block w-px bg-fg shadow-[0_0_8px_var(--color-fg)]"
            style={{
              left: `${frame.playhead * 100}%`,
              opacity: frame.playhead > 0 && frame.playhead < 1 ? 1 : 0,
            }}
          />
        </div>
        <p className="mt-2.5 text-[11.5px] text-muted">{t('home.declick.noise')}</p>
        <Segmented
          options={[
            t('home.declick.off'),
            t('home.declick.soft'),
            t('home.declick.medium'),
            t('home.declick.strong'),
          ]}
          active={frame.noise === 'medium' ? 2 : 0}
          refs={{ 2: noise }}
        />
        <span
          ref={listen}
          className={`mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-xs transition-colors duration-200 ${
            frame.playhead > 0 && frame.playhead < 1 ? 'bg-[#292e42] text-fg' : 'text-[#a9b1d6]'
          }`}
          style={{
            opacity: frame.listen ? 1 : 0,
            transform: frame.listen ? 'none' : 'translateY(6px)',
            transition: `opacity 0.3s ease, transform 0.4s ${EASE}`,
          }}
        >
          <Glyph size={12}>{ICONS.play}</Glyph>
          {t('home.declick.listen')}
        </span>
        <SceneCursor container={panel} target={frame.cursor ? targets[frame.cursor] : null} />
      </EditorPanel>
    </div>
  )
}
