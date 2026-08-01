import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { trimFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import { TAIL_ENVELOPE, TRACK_ENVELOPE } from '../../lib/waveforms'
import WaveStrip from './WaveStrip'

// Seconds of tail the trim drops, at the fraction the cut currently sits on. Only
// used for the readout, so an approximate scale beats threading a real duration
// through: the number has to move with the cut, and the copy already calls the
// whole strip the last 12 seconds.
const TAIL_SECONDS = 16.4

// The cut slides in from the end, overshoots, and settles onto the last beat. The
// static version showed it already parked there, which states the magnet rather
// than showing it — and the magnet is what the section is selling.
export default function TrimScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const frame = trimFrame(useSceneProgress(ref, 4200))

  return (
    <div ref={ref} className="p-5">
      <WaveStrip
        values={TAIL_ENVELOPE}
        gap={0.12}
        cut={frame.cut}
        height="h-32"
        label={t('home.trim.tailLabel')}
      />
      <div className="mt-4 flex items-baseline justify-between gap-3 font-mono text-[10px]">
        <span
          className={`transition-colors duration-300 ${frame.locked ? 'text-cyan' : 'text-faint'}`}
        >
          {frame.locked ? t('home.trim.magnet') : t('home.trim.seeking')}
        </span>
        <span className="text-faint tabular-nums">
          {t('home.trim.trimmed', { seconds: ((1 - frame.cut) * TAIL_SECONDS).toFixed(1) })}
        </span>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <WaveStrip
          values={TRACK_ENVELOPE}
          gap={0.1}
          height="h-14"
          label={t('home.trim.fullLabel')}
        />
        <p className="mt-2 font-mono text-[10px] text-faint">{t('home.trim.fullLabel')}</p>
      </div>
    </div>
  )
}
