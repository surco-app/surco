import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pickInstallerRelease } from '../lib/downloads'
import { detectOS, installerSuffix, type OS } from '../lib/os'
import { btnPrimary } from '../lib/ui'
import { formatVersion } from '../lib/version'
import DownloadCount from './DownloadCount'

const REPO = 'surco-app/surco-releases'
const RELEASES = `https://github.com/${REPO}/releases/latest`

const LABEL: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  other: '',
  unknown: '',
}

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
  // Starts 'unknown' in the prerender (no navigator) and resolves on mount, so the
  // static HTML carries a pending CTA rather than the generic fallback link.
  const [os, setOs] = useState(detectOS)
  useEffect(() => {
    setOs(detectOS())
  }, [])
  const [href, setHref] = useState<string | null>(null)
  const [intelHref, setIntelHref] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  // The installer weighs ~160-200 MB. Saying so before the click is the difference
  // between a considered download and a surprise on a metered or slow connection —
  // and the number rides in the release payload already fetched for the URL.
  const [size, setSize] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (os === 'other' || os === 'unknown') return
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((releases) => {
        if (cancelled || !Array.isArray(releases)) return
        const suffix = installerSuffix(os)
        const rel = pickInstallerRelease(releases, suffix)
        if (!rel) return
        setVersion(formatVersion(rel.tag_name))
        const url = (s: string) =>
          rel.assets?.find((a) => a.name.endsWith(s))?.browser_download_url ?? null
        setHref(url(suffix))
        setSize(rel.assets?.find((a) => a.name.endsWith(suffix))?.size ?? null)
        if (os === 'mac') setIntelHref(url('x64.dmg'))
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
  // Before detection runs (the prerender) the CTA can't name a platform, so it shows the
  // same pending spinner as an in-flight fetch rather than the 'other' fallback link.
  const pending = os === 'unknown'

  return (
    <>
      <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {pending ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-busy="true"
            data-testid="download-cta-pending"
            className="inline-flex cursor-wait items-center gap-2 rounded-full bg-surface px-7 py-3 text-sm font-semibold text-muted ring-1 ring-line"
          >
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            {t('download.cta', { os: 'macOS' })}
          </button>
        ) : os === 'other' ? (
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
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
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
        // On an Intel Mac this link IS the working download — the big button offers
        // arm64 because the browser can't tell the two apart — so it reads at the
        // legible step above `faint` rather than in the page's quietest style. Same
        // line, same reserved height: the CLS reservation above is unaffected.
        className={`mt-3 inline-block text-sm text-muted underline-offset-2 transition-colors hover:text-blue hover:underline ${
          os === 'mac' && intelHref ? '' : 'invisible'
        }`}
      >
        {t('download.intel')}
      </a>
      {/* Windows ships unsigned, so SmartScreen's blue "Windows protected your PC"
          panel is systematic, not occasional — and it appears once the visitor has
          left the site, where the FAQ that explains it can't reach them. The macOS
          half of this reassurance ("notarised by Apple") is already on the page; this
          is its missing counterpart, shown only to the platform that hits the wall. */}
      {os === 'windows' && (
        <p data-testid="download-smartscreen" className="mt-3 max-w-md text-sm text-muted">
          {t('download.smartscreen')}
        </p>
      )}
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
              {size !== null && (
                <span data-testid="download-size" className="text-faint tabular-nums">
                  {Math.round(size / 1_000_000)} MB
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </>
  )
}
