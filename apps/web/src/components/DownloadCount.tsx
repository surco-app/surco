import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countDownloads, fetchAllReleases } from '../lib/downloads'

const REPO = 'surco-app/surco-releases'

// Once the real count lands, tick from ~85% of it up to the final number over
// ~600ms — a short "still climbing" beat, not a from-zero odometer (which reads
// as fake). tabular-nums on the display keeps the ticking digits from jittering.
function useCountUp(target: number | null) {
  const [shown, setShown] = useState<number | null>(null)

  useEffect(() => {
    if (target === null) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }
    const from = Math.floor(target * 0.85)
    // Set synchronously so the first painted frame already shows the ramp start,
    // not a one-frame flash of the final number before the ticks begin.
    setShown(from)
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / 600, 1)
      const eased = 1 - (1 - t) ** 3
      setShown(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])

  return shown
}

// Live social proof, from the same public releases repo the button reads.
// Stays hidden until at least one real download lands, so the page never shows
// "0 descargas" before launch. The count is the highlight; a glowing dot reads
// as "still climbing".
export default function DownloadCount() {
  const { t, i18n } = useTranslation()
  const [count, setCount] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  const shown = useCountUp(count)

  useEffect(() => {
    let cancelled = false
    fetchAllReleases(REPO)
      .then((releases) => {
        if (cancelled) return
        setCount(countDownloads(releases))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // While the paginated releases fetch is in flight, hold the count's slot with a
  // pulse placeholder so the version next to it doesn't get shoved sideways when
  // the number lands.
  if (!settled)
    return (
      <span
        data-testid="download-count-loading"
        aria-hidden="true"
        className="inline-block h-3 w-32 animate-pulse rounded bg-line align-middle"
      />
    )

  if (!count) return null

  return (
    <span data-testid="download-count" className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full bg-blue"
        style={{ animation: 'glow 2s ease-in-out infinite' }}
      />
      <span>
        <span className="tabular-nums text-sm font-semibold text-blue">
          {(shown ?? count).toLocaleString(i18n.language)}
        </span>{' '}
        <span className="text-faint">{t('download.countSuffix')}</span>
      </span>
    </span>
  )
}
