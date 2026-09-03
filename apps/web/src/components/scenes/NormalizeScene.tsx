import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { NORMALIZE_TARGET, normalizeFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'

// Three tracks bought at three different masters, sliding into line on one target.
// The bars carry the argument — a static list of LUFS figures states that they differ,
// where watching them level says what normalization is for without a sentence.
export default function NormalizeScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const { bars, matched } = normalizeFrame(useSceneProgress(ref, 3200))

  return (
    <div ref={ref} className="p-5">
      <div className="flex flex-col gap-4">
        {bars.map(({ title, lufs, gain, level }) => (
          <div key={title}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-muted">{title}</span>
              <span className="flex-none font-mono text-[10px] tabular-nums text-faint">
                {gain > 0 ? '+' : ''}
                {gain.toFixed(1)} dB
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface2">
              <div
                className={`h-full rounded-full transition-colors duration-500 ${
                  matched ? 'bg-green' : 'bg-blue'
                }`}
                style={{ width: `${level * 100}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] tabular-nums text-faint">
              {lufs.toFixed(1)} LUFS
            </p>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-line pt-3.5 font-mono text-[10px] text-faint">
        {t('home.normalize.target', { target: NORMALIZE_TARGET })}
      </p>
    </div>
  )
}
