import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type DownloadLocation, trackDownload } from '../lib/analytics'
import { downloadState } from '../lib/downloadState'
import { fetchInstallerReleasesCached, pickInstallerRelease } from '../lib/downloads'
import {
  detectMacArch,
  detectOS,
  installerSuffix,
  type MacArch,
  macInstallers,
  montereyUrl,
  type OS,
} from '../lib/os'
import { btnPrimary } from '../lib/ui'
import { formatVersion } from '../lib/version'
import DownloadCount from './DownloadCount'

const REPO = 'surco-app/surco-releases'
const RELEASES = `https://github.com/${REPO}/releases/latest`

const LABEL: Record<OS, string> = {
  mac: 'Mac',
  windows: 'Windows',
  linux: 'Linux',
  other: '',
  unknown: '',
}

const primary = `inline-flex ${btnPrimary} px-7 py-3 text-sm`
const altLink =
  'text-muted underline decoration-muted/35 underline-offset-[3px] transition-colors hover:text-blue hover:decoration-current'

// Resolves the installer for the visitor's OS from the newest published release that
// actually carries it. A brand-new release shows up before CI finishes uploading its 12
// assets, so picking from the releases list (not just /releases/latest) keeps the previous
// build's working download instead of flashing an apology during a release.
//
// macOS ships two builds. Chromium browsers say which CPU the Mac has and get its build
// on the big button; Safari and Firefox can't tell (both report "Intel Mac"), so there it
// defaults to arm64, the vast majority of Macs. A discreet link below offers the other.
export default function DownloadButton({
  location,
  showMeta = true,
  note,
  center = false,
  showCount = true,
}: {
  // Which of the eight placements this is, reported with the click. Several of them share
  // a page, so page_path alone cannot say which CTA earned the download.
  location: DownloadLocation
  showMeta?: boolean
  // Reassurance that belongs to the button rather than the section around it.
  // The hero uses it for price and platforms. Sits directly under the CTA, above
  // the reserved Intel line, so it reads as part of the offer and not as a stray
  // caption floating below the fold.
  note?: string
  // A centred hero lines the button and its small print up on the page's axis.
  center?: boolean
  // The home hero shows the count in its own pill above the headline instead.
  showCount?: boolean
}) {
  const { t } = useTranslation()
  // Starts 'unknown' in the prerender (no window) and resolves on mount, so the
  // static HTML carries a pending CTA rather than the generic fallback link.
  const [os, setOs] = useState(detectOS)
  useEffect(() => {
    setOs(detectOS())
  }, [])
  const [href, setHref] = useState<string | null>(null)
  const [otherMacHref, setOtherMacHref] = useState<string | null>(null)
  const [macArch, setMacArch] = useState<MacArch | undefined>(undefined)
  const [version, setVersion] = useState<string | null>(null)
  // The installer weighs ~160-200 MB. Saying so before the click is the difference
  // between a considered download and a surprise on a metered or slow connection —
  // and the number rides in the release payload already fetched for the URL.
  const [size, setSize] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  // Whether the releases request itself broke, as opposed to answering with no build
  // for this OS. Swallowing it (the old bare `.catch`) left the page unable to tell a
  // GitHub outage from an unshipped product, so both got the same apology.
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (os === 'other' || os === 'unknown') return
    let cancelled = false
    const arch = os === 'mac' ? detectMacArch() : Promise.resolve(undefined)
    Promise.all([arch, fetchInstallerReleasesCached(REPO)])
      .then(([arch, releases]) => {
        if (cancelled) return
        const mac = macInstallers(arch)
        const suffix = os === 'mac' ? mac.primary : installerSuffix(os)
        const rel = pickInstallerRelease(releases, suffix)
        if (!rel) return
        setMacArch(arch)
        setVersion(formatVersion(rel.tag_name))
        const url = (s: string) =>
          rel.assets?.find((a) => a.name.endsWith(s))?.browser_download_url ?? null
        setHref(url(suffix))
        setSize(rel.assets?.find((a) => a.name.endsWith(suffix))?.size ?? null)
        if (os === 'mac') setOtherMacHref(url(mac.secondary))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setSettled(true)
      })
    return () => {
      cancelled = true
    }
  }, [os])

  // 'other' has no installer to resolve — its CTA is the generic releases link, which
  // is already a working answer — so it counts as settled rather than as a failure.
  const state = os === 'other' ? 'ready' : downloadState({ href, failed, settled })
  // Before detection runs (the prerender) the CTA can't name a platform, so it shows the
  // same pending spinner as an in-flight fetch rather than the 'other' fallback link.
  const pending = os === 'unknown'
  // Shown once the other Mac build resolves, never on the OS check alone: the OS is already
  // known in the first client render, and hydration never patches that onto the attributes
  // of the prerendered HTML, so a line gated on it alone stayed invisible.
  const showAlternatives = os === 'mac' && otherMacHref !== null
  const chip = t(macArch === 'x64' ? 'download.archIntel' : 'download.archAppleSilicon')
  const otherChip = t(macArch === 'x64' ? 'download.archAppleSilicon' : 'download.archIntel')
  const montereyHref = montereyUrl(macArch)
  const facts = [
    version,
    os === 'mac' && href ? chip : null,
    size !== null ? `${Math.round(size / 1_000_000)} MB` : null,
    os === 'mac' && href ? t('download.macRequirement') : null,
  ].filter((fact): fact is string => fact !== null)

  return (
    <>
      <div
        className={`mt-7 flex flex-col gap-4 sm:flex-row sm:items-center ${
          center ? 'items-center sm:justify-center' : 'items-start'
        }`}
      >
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
            {t('download.cta', { os: 'Mac' })}
          </button>
        ) : os === 'other' ? (
          <a
            href={RELEASES}
            className={primary}
            onClick={() => trackDownload({ href: RELEASES, os, location })}
          >
            {t('download.viewDownloads')}
          </a>
        ) : href ? (
          <a
            href={href}
            className={primary}
            onClick={() => trackDownload({ href, os, location, ...(version ? { version } : {}) })}
          >
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
            {t('download.cta', { os: LABEL[os] || 'Mac' })}
          </button>
        )}
      </div>
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
        // version+size once the releases fetch lands, which would shift the hero. The note
        // sits on its own line above, and the facts below it name what the button downloads
        // and what it needs, so a Mac on macOS 12 learns it before the installer refuses.
        <>
          {note && (
            <p className={`mt-3.5 text-sm text-muted ${center ? 'text-center' : ''}`}>{note}</p>
          )}
          <div
            className={`${note ? 'mt-1.5' : 'mt-3.5'} flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint ${
              center ? 'justify-center' : ''
            }`}
          >
            {state === 'pending' ? null : state === 'unreachable' ? (
              // The releases lookup broke — GitHub's REST listing has answered 504 for
              // every repo at once before now, while /releases/latest stayed up. Saying
              // "not available yet" here would blame the product for someone else's
              // outage and leave the visitor stuck, so name it and hand over the link
              // that still works.
              <p data-testid="download-unreachable">
                {t('download.unreachable')}{' '}
                <a
                  href={RELEASES}
                  className="text-muted underline underline-offset-2 transition-colors hover:text-blue"
                  onClick={() => trackDownload({ href: RELEASES, os, location })}
                >
                  {t('download.unreachableLink')}
                </a>
              </p>
            ) : state === 'unsupported' ? (
              <p data-testid="download-unsupported">{t('download.unsupported')}</p>
            ) : (
              <>
                {facts.length > 0 && (
                  <span data-testid="download-facts" className="font-mono text-faint tabular-nums">
                    {facts.join(' · ')}
                  </span>
                )}
                {showCount && <DownloadCount />}
              </>
            )}
          </div>
        </>
      )}
      {/* Always mounted, invisible until the other Mac build resolves, so the line occupies
          its place in the prerendered HTML and every client state alike. The page is
          statically prerendered with no OS, so inserting the line only after hydration would
          shove the hero screenshot and decorative waves down and spike CLS. The reserved
          line costs non-Mac visitors a blank row. Both alternatives share one line so the
          exceptions stop outweighing the button. */}
      <p
        data-testid="download-alternatives"
        aria-hidden={showAlternatives ? undefined : true}
        className={`mt-2 text-sm text-faint ${showAlternatives ? '' : 'invisible'}`}
      >
        {t('download.alsoFor')}{' '}
        <a
          href={showAlternatives && otherMacHref ? otherMacHref : undefined}
          tabIndex={showAlternatives ? undefined : -1}
          data-testid="download-other-mac"
          className={altLink}
          onClick={() => {
            if (showAlternatives && otherMacHref)
              trackDownload({ href: otherMacHref, os, location, ...(version ? { version } : {}) })
          }}
        >
          {t('download.macWith', { chip: otherChip })}
        </a>
        <span aria-hidden="true"> · </span>
        <a
          href={showAlternatives ? montereyHref : undefined}
          tabIndex={showAlternatives ? undefined : -1}
          data-testid="download-monterey"
          className={altLink}
          onClick={() => {
            if (showAlternatives)
              trackDownload({ href: montereyHref, os, location, version: 'v1.2.3' })
          }}
        >
          {t('download.monterey')}
        </a>
      </p>
    </>
  )
}
