import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { declickFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { DECLICK_ENVELOPE, DECLICK_MARKS } from '../../lib/waveforms'
import WaveStrip from './WaveStrip'

// The playhead sweeps the waveform and each click lights as it is reached, then
// stays lit — the scene's claim is that Surco *found* them, so they accumulate. The
// A/B toggle flips on its own because the copy promises you can hear the repair
// against the original, and a toggle that never moves only asserts that.
export default function DeclickScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = declickFrame(useSceneProgress(ref, 5000))

  return (
    <div ref={ref} className="p-5">
      <WaveStrip
        values={DECLICK_ENVELOPE}
        marks={DECLICK_MARKS}
        hitMark={frame.hitIndex}
        foundMarks={frame.found}
        playhead={frame.playhead}
        height="h-36 sm:h-44"
        label={t('home.declick.title')}
      />
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="inline-flex overflow-hidden rounded-lg border border-line font-mono text-xs">
          <span
            className={`px-3 py-1.5 transition-colors duration-200 ${
              frame.hearingOriginal ? 'text-muted' : 'bg-blue/20 text-blue'
            }`}
          >
            {t('home.declick.hearing')}
          </span>
          <span
            className={`px-3 py-1.5 transition-colors duration-200 ${
              frame.hearingOriginal ? 'bg-blue/20 text-blue' : 'text-muted'
            }`}
          >
            {t('home.declick.original')}
          </span>
        </span>
        <span className="font-mono text-[11px] text-faint tabular-nums">
          {t('home.declick.clickCount', { count: frame.found })}
        </span>
      </div>
    </div>
  )
}
