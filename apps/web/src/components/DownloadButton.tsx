import { useEffect, useState } from 'react'

const REPO = 'vigosan/surco-releases'
const RELEASES = `https://github.com/${REPO}/releases/latest`

type OS = 'mac' | 'windows' | 'other'

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Mac/i.test(ua)) return 'mac'
  return 'other'
}

const EXT: Record<OS, string | null> = { mac: '.dmg', windows: '.exe', other: null }
const LABEL: Record<OS, string> = { mac: 'macOS', windows: 'Windows', other: '' }

const primary =
  'rounded-full bg-blue px-7 py-3 text-sm font-semibold text-bg transition-colors hover:bg-cyan'

// Resolves the installer for the visitor's OS from the newest published GitHub
// release. /releases/latest skips drafts, so until the first release is
// published the fetch 404s and the button stays disabled on its own — no manual
// flag to flip when the binaries land.
export default function DownloadButton() {
  const [os] = useState(detectOS)
  const [href, setHref] = useState<string | null>(null)

  useEffect(() => {
    const ext = EXT[os]
    if (!ext) return
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const asset = data?.assets?.find((a: { name: string }) => a.name.endsWith(ext))
        if (!cancelled && asset) setHref(asset.browser_download_url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [os])

  const ready = href !== null || os === 'other'

  return (
    <>
      <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {os === 'other' ? (
          <a href={RELEASES} className={primary}>
            Ver descargas
          </a>
        ) : href ? (
          <a href={href} className={primary}>
            Descargar para {LABEL[os]}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="cursor-not-allowed rounded-full bg-surface px-7 py-3 text-sm font-semibold text-muted ring-1 ring-line"
          >
            Descargar para {LABEL[os] || 'macOS'}
          </button>
        )}
        <a
          href="#analisis"
          className="text-sm font-medium text-fg transition-colors hover:text-blue"
        >
          Ver el análisis →
        </a>
      </div>
      <p className="mt-4 font-mono text-xs text-faint">
        {ready
          ? 'Descarga gratuita.'
          : 'La descarga aún no está disponible — estamos puliendo la primera versión.'}
        <br />
        También llega a Windows, con todo igual salvo el envío automático a Apple Music.
      </p>
    </>
  )
}
