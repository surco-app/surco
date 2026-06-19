import { describe, expect, it } from 'vitest'
import { isBlockedFetchUrl, isInternalNavigation, isWebUrl } from './navigation'

describe('isWebUrl', () => {
  it('accepts http and https so external links open in the browser', () => {
    expect(isWebUrl('https://discogs.com/release/1')).toBe(true)
    expect(isWebUrl('http://localhost:5173')).toBe(true)
  })

  // A link carrying a non-web scheme must never reach shell.openExternal: file://,
  // smb:// or a custom protocol handler would be launched outside the browser, which
  // is the whole point of the allowlist.
  it('rejects file, custom and other schemes', () => {
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('smb://server/share')).toBe(false)
    expect(isWebUrl('surco://media/x')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects garbage that does not parse as a URL', () => {
    expect(isWebUrl('not a url')).toBe(false)
    expect(isWebUrl('')).toBe(false)
  })
})

describe('isInternalNavigation', () => {
  it('allows navigation that stays on the app origin', () => {
    expect(isInternalNavigation('http://localhost:5173/#x', 'http://localhost:5173')).toBe(true)
    expect(isInternalNavigation('file:///app/index.html#view', 'file:///app/index.html')).toBe(true)
  })

  // A compromised renderer navigating the top frame to a remote origin would escape
  // the local CSP; the guard must reject anything off-origin so it can be blocked.
  it('rejects navigation to a different origin', () => {
    expect(isInternalNavigation('https://evil.example/x', 'http://localhost:5173')).toBe(false)
    expect(isInternalNavigation('https://evil.example/x', 'file:///app/index.html')).toBe(false)
  })

  it('rejects unparseable targets', () => {
    expect(isInternalNavigation('not a url', 'http://localhost:5173')).toBe(false)
  })
})

describe('isBlockedFetchUrl', () => {
  // The cover-download path fetches whatever URL the renderer names, so a compromised
  // renderer could turn it into an SSRF probe. A real cover dragged from a public site
  // must still go through.
  it('allows ordinary public web covers', () => {
    expect(isBlockedFetchUrl('https://i.discogs.com/x/cover.jpg')).toBe(false)
    expect(isBlockedFetchUrl('http://f4.bcbits.com/img/a.jpg')).toBe(false)
  })

  // The headline target: cloud-metadata, loopback and private-range literals must be
  // refused before the fetch so their bytes never come back to the renderer.
  it('blocks loopback, link-local and private address literals', () => {
    expect(isBlockedFetchUrl('http://169.254.169.254/latest/meta-data/')).toBe(true)
    expect(isBlockedFetchUrl('http://127.0.0.1:9000/')).toBe(true)
    expect(isBlockedFetchUrl('http://localhost:8080/admin')).toBe(true)
    expect(isBlockedFetchUrl('http://10.0.0.5/')).toBe(true)
    expect(isBlockedFetchUrl('http://192.168.1.1/')).toBe(true)
    expect(isBlockedFetchUrl('http://172.16.0.1/')).toBe(true)
    expect(isBlockedFetchUrl('http://[::1]/')).toBe(true)
  })

  // Only web schemes are fetchable; file:// or a custom scheme would read off disk.
  it('blocks non-web schemes and unparseable input', () => {
    expect(isBlockedFetchUrl('file:///etc/passwd')).toBe(true)
    expect(isBlockedFetchUrl('surco://media/x')).toBe(true)
    expect(isBlockedFetchUrl('not a url')).toBe(true)
  })
})
