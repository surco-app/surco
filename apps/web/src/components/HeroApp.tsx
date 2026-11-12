import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// The product, full width, immediately under the headline — a visitor should know
// what Surco is before reading a word. The still ships in the static HTML so the
// window is there at first paint; the loop, when present, fades over it once it can
// actually play, and never on a connection or a preference that shouldn't carry it.
export default function HeroApp({ video }: { video?: boolean }) {
  const { t, i18n } = useTranslation()
  // The still is the video's own first frame, so the loop starts without the image
  // jumping to a different state underneath it. Each language has its own recording
  // (marketing-video's hero.mjs), so the app on screen speaks the page's language.
  const base = `/hero-app-${i18n.language}`
  const shot = `${base}.webp`
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)

  const togglePause = () => {
    const el = ref.current
    if (!el) return
    if (paused) el.play()
    else el.pause()
    setPaused(!paused)
  }

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
      <div className="overflow-hidden rounded-xl ring-1 ring-line/60">
        <div className="group relative">
          <img
            src={shot}
            srcSet={`${base}-800.webp 800w, ${base}-1200.webp 1200w, ${shot} 2000w`}
            sizes="(min-width: 1104px) 1024px, (min-width: 640px) calc(100vw - 5rem), calc(100vw - 3rem)"
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
              aria-hidden="true"
              tabIndex={-1}
              muted
              loop
              playsInline
              preload="none"
              className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ease-out ${
                playing ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <source src={`${base}.webm`} type="video/webm" />
              <source src={`${base}.mp4`} type="video/mp4" />
            </video>
          )}
          {playing && (
            <button
              type="button"
              data-testid="hero-video-pause"
              aria-pressed={paused}
              aria-label={t('showcase.pause')}
              onClick={togglePause}
              className="absolute right-3 bottom-3 z-10 grid size-9 place-items-center rounded-full border border-line bg-bg2/85 text-fg opacity-0 backdrop-blur-sm transition-[opacity,scale] duration-200 group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.97] [@media(hover:none)]:opacity-100"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                {paused ? <path d="M7 4.5v15l12-7.5z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
