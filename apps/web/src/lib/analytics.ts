import type { OS } from './os'

// Where on the site the download button was clicked. The same component renders in six
// places, several of them on one page, so page_path alone cannot say which CTA converts.
export type DownloadLocation =
  | 'hero'
  | 'home-closing'
  | 'features'
  | 'guide'
  | 'changelog'
  | 'install'

// Which donate link left for PayPal. 'donate-retry' is the odd one out and the reason
// this is not just a boolean: it sits on the page PayPal returns a cancelled payment to,
// so it counts recovered donations rather than intent.
export type DonateLocation = 'header' | 'header-mobile' | 'donate-retry'

// Sections worth knowing a visitor reached. Deliberately few: a section_view on every
// band would drown the report and cost a listener per section for questions nobody asks.
export type SectionLocation = 'home-closing' | 'install'

// An installer is a file the visitor can run; the releases page is the fallback link
// shown on a platform with no Surco build. Both are worth counting and they must not be
// added together, or the download report counts clicks that downloaded nothing.
type DownloadKind = 'installer' | 'releases_page'

export type DownloadEvent = {
  file_name: string
  file_extension: string
  link_url: string
  surco_kind: DownloadKind
  surco_location: DownloadLocation
  surco_os: OS
  surco_version?: string
}

export type DownloadClick = {
  href: string
  os: OS
  location: DownloadLocation
  version?: string
}

// GA4's file_download reports read file_name and file_extension, so both come from the
// asset URL rather than from the OS: the two macOS builds share a platform and differ
// only in the file name, which is the one place Analytics can tell arm64 from x64.
export function downloadEvent({ href, os, location, version }: DownloadClick): DownloadEvent {
  const name = href.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  return {
    file_name: name,
    file_extension: extension,
    link_url: href,
    surco_kind: extension ? 'installer' : 'releases_page',
    surco_location: location,
    surco_os: os,
    ...(version ? { surco_version: version } : {}),
  }
}

// gtag is defined only in production, by GoogleAnalytics.tsx. In dev, in the prerender
// and behind an ad blocker it is absent, and every one of these events rides on a click
// that must still do its job — download, copy, navigate — rather than throw on a
// missing global. Measuring is never allowed to break the thing being measured.
function sendEvent(name: string, params: Record<string, unknown>): void {
  const gtag = (globalThis as { gtag?: (...args: unknown[]) => void }).gtag
  if (typeof gtag !== 'function') return
  gtag('event', name, params)
}

export function trackDownload(click: DownloadClick): void {
  sendEvent('file_download', downloadEvent(click))
}

// Copying the Homebrew command installs Surco without ever fetching a release asset,
// so file_download cannot see it: on macOS it is the other half of the install story.
export function trackBrewCopy(location: SectionLocation): void {
  sendEvent('brew_copy', { surco_location: location })
}

// The donate links leave for PayPal, so this click is the last thing the site observes.
export function trackDonate(location: DonateLocation): void {
  sendEvent('donate_click', { surco_location: location })
}

// Fired once when a section scrolls into view, to measure how far down the page the
// visitors who convert actually get.
export function trackSectionView(location: SectionLocation): void {
  sendEvent('section_view', { surco_location: location })
}
