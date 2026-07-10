import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pickInstallerRelease } from '../lib/downloads'
import { btnPrimary } from '../lib/ui'
import { formatVersion } from '../lib/version'
import DownloadCount from './DownloadCount'

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

const LABEL: Record<OS, string> = { mac: 'macOS', windows: 'Windows', other: '' }

const primary = `inline-flex ${btnPrimary} px-7 py-3 text-sm`

// Resolves the installer for the visitor's OS from the newest published release that
// actually carries it. A brand-new release shows up before CI finishes uploading its 12
// assets, so picking from the releases list (not just /releases/latest) keeps the previous
// build's working download instead of flashing "unavailable" during a release.
//
// macOS ships two builds. The browser can't tell Apple Silicon from Intel (Safari
// reports both as "Intel Mac"), so the big button defaults to arm64 — the vast
// majority of Macs — and a discreet link below covers Intel.
export default function DownloadButton({ showMeta = true }: { showMeta?: boolean }) {
  const { t } = useTranslation()
  const [os] = useState(detectOS)
  const [href, setHref] = useState<string | null>(null)
  const [intelHref, setIntelHref] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (os === 'other') return
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((releases) => {
        if (cancelled || !Array.isArray(releases)) return
        const rel = pickInstallerRelease(releases, os === 'mac' ? 'arm64.dmg' : '.exe')
        if (!rel) return
        setVersion(formatVersion(rel.tag_name))
        const url = (suffix: string) =>
          rel.assets?.find((a) => a.name.endsWith(suffix))?.browser_download_url ?? null
        if (os === 'mac') {
          setHref(url('arm64.dmg'))
          setIntelHref(url('x64.dmg'))
        } else {
          setHref(url('.exe'))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettled(true)
      })
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
            {t('download.viewDownloads')}
          </a>
        ) : href ? (
          <a href={href} className={primary}>
            {t('download.cta', { os: LABEL[os] })}
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-busy="true"
            className="inline-flex cursor-wait items-center gap-2 rounded-full bg-surface px-7 py-3 text-sm font-semibold text-muted ring-1 ring-line"
          >
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {t('download.cta', { os: LABEL[os] || 'macOS' })}
          </button>
        )}
      </div>
      {/* Always mounted (invisible until the Intel build resolves on a Mac) so the
          link occupies its line in the prerendered HTML and every client state
          alike. The page is statically prerendered with os='other', so gating this
          on the OS check or the releases fetch would insert the line only after
          hydration — shoving the hero screenshot and decorative waves down and
          spiking CLS. The reserved line costs non-Mac visitors a blank row. */}
      {/* biome-ignore lint/a11y/useAnchorContent: intentionally aria-hidden when there's no Intel link to show — it's a CLS-reserving placeholder (see above), not a real link for assistive tech */}
      <a
        href={os === 'mac' && intelHref ? intelHref : undefined}
        aria-hidden={os === 'mac' && intelHref ? undefined : true}
        tabIndex={os === 'mac' && intelHref ? undefined : -1}
        className={`mt-3 inline-block font-mono text-xs text-faint underline-offset-2 transition-colors hover:text-blue hover:underline ${
          os === 'mac' && intelHref ? '' : 'invisible'
        }`}
      >
        {t('download.intel')}
      </a>
      {showMeta && (
        // min-h reserves one line so the row doesn't grow from empty (prerender) to
        // count+version once the releases fetch lands, which would shift the hero.
        <div className="mt-5 min-h-5 font-mono text-xs text-faint">
          {!ready && !settled ? (
            // The fetch is still in flight — a pulse placeholder, not the
            // "unavailable" copy, which is reserved for a fetch that came back empty.
            <span
              data-testid="download-meta-loading"
              aria-hidden="true"
              className="inline-block h-3 w-44 max-w-full animate-pulse rounded bg-line align-middle"
            />
          ) : !ready ? (
            <p>{t('download.unavailable')}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-2">
              <DownloadCount />
              {version && (
                <span data-testid="app-version" className="text-faint tabular-nums">
                  {version}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </>
  )
}
