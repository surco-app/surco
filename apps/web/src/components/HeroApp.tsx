import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// The product, full width, immediately under the headline — a visitor should know
// what Surco is before reading a word. The still ships in the static HTML so the
// window is there at first paint; the loop, when present, fades over it once it can
// actually play, and never on a connection or a preference that shouldn't carry it.
export default function HeroApp({ video }: { video?: boolean }) {
  const { t } = useTranslation()
  // The still is the video's own first frame, so the loop starts without the image
  // jumping to a different state underneath it. One capture serves both languages:
  // it shows the current build, and the older per-language shots were a version
  // behind. Swap in a Spanish recording when there is one.
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
      <div className="overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-line/60">
        <div className="relative">
          <img
            src={shot}
            alt={t('showcase.alt')}
            width={2000}
            height={1242}
            fetchPriority="high"
            decoding="async"
            className="block h-auto w-full"
          />
          {video && (
            // VP9 first: on a screen recording it lands about the same size as H.264
            // at a noticeably higher resolution. The MP4 covers the browsers that
            // don't take WebM.
            <video
              ref={ref}
              poster={shot}
              muted
              loop
              playsInline
              preload="none"
              className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${
                playing ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <source src="/hero-app.webm" type="video/webm" />
              <source src="/hero-app.mp4" type="video/mp4" />
            </video>
          )}
        </div>
      </div>
    </div>
  )
}
