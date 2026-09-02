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
// and behind an ad blocker it is absent, and the click must still reach the download.
export function trackDownload(click: DownloadClick): void {
  const gtag = (globalThis as { gtag?: (...args: unknown[]) => void }).gtag
  if (typeof gtag !== 'function') return
  gtag('event', 'file_download', downloadEvent(click))
}
