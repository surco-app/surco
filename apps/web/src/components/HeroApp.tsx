import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// The product, full width, immediately under the headline — a visitor should know
// what Surco is before reading a word. The still ships in the static HTML so the
// window is there at first paint; the loop, when present, fades over it once it can
// actually play, and never on a connection or a preference that shouldn't carry it.
export default function HeroApp({ video }: { video?: string }) {
  const { t } = useTranslation()
  // One screenshot for both languages for now: this is the current build's UI, and
  // the older per-language shots are a version behind. Swap in a Spanish capture when
  // there is one.
  const shot = '/hero-app.webp'
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!video) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        el.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        )
        io.disconnect()
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [video])

  return (
    <div className="relative">
      <div className="inset-shadow-edge overflow-hidden rounded-2xl border border-line bg-surface2/60 shadow-2xl shadow-black/50">
        <div className="relative">
          <img
            src={shot}
            alt={t('showcase.alt')}
            width={2000}
            height={1240}
            fetchPriority="high"
            decoding="async"
            className="block h-auto w-full"
          />
          {video && (
            <video
              ref={ref}
              src={video}
              poster={shot}
              muted
              loop
              playsInline
              preload="none"
              className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${
                playing ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}
        </div>
      </div>
    </div>
  )
}
