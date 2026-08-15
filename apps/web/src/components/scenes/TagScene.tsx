import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TAG_TOTAL, tagFrame } from '../../lib/scenes'
import { useSceneProgress } from '../../lib/useSceneProgress'
import AppFrame from './AppFrame'

const MATCHES = [
  { title: 'When I Fall In Love', meta: '1995 · Factory Team · FT-012', src: 'Discogs' },
  { title: 'Euro Club Vol. 3', meta: '1995 · Rise', src: 'Deezer' },
  { title: 'When I Fall In Love', meta: '1996 · self-released', src: 'Bandcamp' },
]

// The junk artist is replaced letter by letter and the fields land one after
// another. That replacement is the scene's whole argument — the static version
// showed it already done, which states the outcome instead of showing the work.
export default function TagScene() {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const progress = useSceneProgress(ref, 5200)
  const frame = tagFrame(progress)
  const done = progress >= 1

  const fieldLabels = [
    t('home.tag.fields.label'),
    t('home.tag.fields.bpm'),
    t('home.tag.fields.key'),
    t('home.tag.fields.year'),
  ]

  // The scene owns the counter, so it draws its own window chrome instead of having
  // Walkthrough pass a frozen "12/40" in from outside — that frozen string was the
  // very thing this animation exists to unfreeze.
  return (
    <AppFrame
      pill={`${frame.done}/${TAG_TOTAL}`}
      busy={!done}
      progress={(frame.done / TAG_TOTAL) * 100}
    >
      <div ref={ref} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {MATCHES.map((r, i) => (
            <div
              key={r.src}
              className={`flex items-center gap-2 rounded-lg border p-2 font-mono text-[11px] transition-colors duration-300 ${
                frame.activeRow === i ? 'border-blue/45 bg-blue/10' : 'border-line'
              }`}
            >
              <span className="size-7 shrink-0 rounded bg-surface" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg/90">{r.title}</span>
                <span className="block truncate text-[10px] text-faint">{r.meta}</span>
              </span>
              <span className="shrink-0 rounded-full border border-line px-1.5 text-[9px] text-faint">
                {r.src}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-2 font-mono text-[11px]">
          <div className="rounded-lg border border-red/45 bg-bg/60 p-2">
            <span className="block text-[9px] tracking-wider text-faint uppercase">
              {t('home.tag.before')}
            </span>
            <span className="mt-1 block break-all text-red">2-2-2c-2e-1-2c-2e-1-2y4c-EF</span>
          </div>
          <div className="rounded-lg border border-green/45 bg-bg/60 p-2">
            <span className="block text-[9px] tracking-wider text-faint uppercase">
              {t('home.tag.after')}
            </span>
            {/* Reserves the line's height from the first frame, so the panel below
              doesn't jump as the name types in. */}
            <span className="mt-1 block min-h-4 text-green">{frame.artist}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {fieldLabels.map((k, i) => (
              <div key={k} className="rounded-lg border border-line bg-bg/60 p-2">
                <span className="block text-[9px] tracking-wider text-faint uppercase">{k}</span>
                <span className="mt-1 block min-h-4 truncate text-fg/90">{frame.fields[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  )
}
