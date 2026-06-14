import { describe, expect, it } from 'vitest'
import { isInternalNavigation, isWebUrl } from './navigation'

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
