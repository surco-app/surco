import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countDownloads, fetchReleasesCached } from '../lib/downloads'

const REPO = 'surco-app/surco-releases'

// A bare number in the footer's small print, for the maintainer rather than the visitor: no
// label, no highlight, the meaning only in the tooltip. Hidden until a real count lands.
export default function DownloadCount() {
  const { t, i18n } = useTranslation()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchReleasesCached(REPO)
      .then((releases) => {
        if (!cancelled) setCount(countDownloads(releases))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!count) return null

  return (
    <span data-testid="download-count" title={t('footer.downloads')} className="tabular-nums">
      {count.toLocaleString(i18n.language)}
    </span>
  )
}
