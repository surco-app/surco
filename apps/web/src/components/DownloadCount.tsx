import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countDownloads } from '../lib/downloads'

const REPO = 'vigosan/surco-releases'

// Live social proof appended to the "Descarga gratuita" line, from the same
// public releases repo the button reads. Stays hidden until at least one real
// download lands, so the page never shows "0 descargas" before launch.
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
    <span data-testid="download-count" className="text-muted">
      {' · '}
      <span className="tabular-nums text-fg">{count.toLocaleString(i18n.language)}</span>{' '}
      {t('download.countSuffix')}
    </span>
  )
}
