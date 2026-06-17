import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countDownloads } from '../lib/downloads'

const REPO = 'vigosan/surco-releases'

// Live social proof, from the same public releases repo the button reads.
// Stays hidden until at least one real download lands, so the page never shows
// "0 descargas" before launch. The count is the highlight; a glowing dot reads
// as "still climbing".
export default function DownloadCount() {
  const { t, i18n } = useTranslation()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        setCount(countDownloads(data))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!count) return null

  return (
    <span data-testid="download-count" className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full bg-blue"
        style={{ animation: 'glow 2s ease-in-out infinite' }}
      />
      <span>
        <span className="tabular-nums text-sm font-semibold text-blue">
          {count.toLocaleString(i18n.language)}
        </span>{' '}
        <span className="text-faint">{t('download.countSuffix')}</span>
      </span>
    </span>
  )
}
