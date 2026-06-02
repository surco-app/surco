import { useEffect, useState } from 'react'
import { countDownloads } from '../lib/downloads'

const REPO = 'vigosan/surco-releases'

// Social proof under the download button, from the same public releases repo the
// button reads. Stays hidden until at least one real download lands, so the page
// never shows "0 descargas" before launch.
export default function DownloadCount() {
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
    <p data-testid="download-count" className="mt-4 font-mono text-xs text-faint">
      <span className="text-fg">{count.toLocaleString('es')}</span> descargas
    </p>
  )
}
