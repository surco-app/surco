import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadEvent, trackDownload } from './analytics'

const RELEASE = 'https://github.com/surco-app/surco-releases/releases/latest'
const DMG =
  'https://github.com/surco-app/surco-releases/releases/download/v0.90.3/Surco-0.90.3-arm64.dmg'

describe('downloadEvent', () => {
  // GA4's own file_download reports key on file_name and file_extension. Deriving both
  // from the asset URL rather than the OS is what keeps the report readable when a
  // release renames an asset, and what distinguishes the two macOS builds: the big
  // button hands out arm64, the discreet link below hands out x64, and only the file
  // name tells them apart in Analytics.
  it('names the file and extension from the installer URL', () => {
    expect(downloadEvent({ href: DMG, os: 'mac', location: 'hero' })).toMatchObject({
      file_name: 'Surco-0.90.3-arm64.dmg',
      file_extension: 'dmg',
      link_url: DMG,
    })
  })

  // The same button sits in six places on the site, several of them on one page. Without
  // this the report can only say "someone downloaded from /", which cannot answer whether
  // the hero CTA or the closing section is doing the work.
  it('carries the section that was clicked and the detected OS', () => {
    expect(downloadEvent({ href: DMG, os: 'mac', location: 'changelog' })).toMatchObject({
      surco_location: 'changelog',
      surco_os: 'mac',
    })
  })

  it('records the release version when one is known', () => {
    expect(
      downloadEvent({ href: DMG, os: 'mac', location: 'hero', version: '0.90.3' }),
    ).toMatchObject({ surco_version: '0.90.3' })
  })

  // A visitor on a phone or an unrecognised OS gets a link to the GitHub releases page,
  // not an installer. Counting that as a file_download would inflate the download report
  // with clicks that never downloaded anything, so it is reported as a distinct kind.
  it('marks the releases-page link as a listing, not an installer', () => {
    const event = downloadEvent({ href: RELEASE, os: 'other', location: 'hero' })
    expect(event.surco_kind).toBe('releases_page')
    expect(event.file_extension).toBe('')
  })

  it('marks a real installer as an installer', () => {
    expect(downloadEvent({ href: DMG, os: 'mac', location: 'hero' }).surco_kind).toBe('installer')
  })
})

describe('trackDownload', () => {
  afterEach(() => {
    delete (globalThis as { gtag?: unknown }).gtag
  })

  it('sends a GA4 file_download event with the payload', () => {
    const gtag = vi.fn()
    ;(globalThis as { gtag?: unknown }).gtag = gtag

    trackDownload({ href: DMG, os: 'mac', location: 'hero' })

    expect(gtag).toHaveBeenCalledWith(
      'event',
      'file_download',
      expect.objectContaining({ file_name: 'Surco-0.90.3-arm64.dmg', surco_location: 'hero' }),
    )
  })

  // gtag only exists in production, where GoogleAnalytics.tsx defines it. In dev, in the
  // prerender and behind an ad blocker it is simply absent, and a click on the download
  // button must still download rather than throw on a missing global.
  it('does nothing when gtag was never loaded', () => {
    expect(() => trackDownload({ href: DMG, os: 'mac', location: 'hero' })).not.toThrow()
  })
})
