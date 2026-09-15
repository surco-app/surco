import { describe, expect, it } from 'vitest'
import { downloadState } from './downloadState'

// The button used to collapse two different failures into one message: a fetch that
// came back fine with no build for this OS, and a fetch that never landed at all.
// Both showed "the download isn't available yet, we're polishing the first version" —
// pre-launch copy that is now three dozen releases out of date, and which tells a
// visitor the product doesn't exist when GitHub's API is simply down. They need
// different answers, so the state has to survive the fetch instead of being thrown away.
describe('downloadState', () => {
  it('is ready once an installer URL resolved', () => {
    expect(downloadState({ href: 'https://example.test/Surco-arm64.dmg', failed: false })).toBe(
      'ready',
    )
  })

  it('is pending while the fetch is still in flight', () => {
    expect(downloadState({ href: null, failed: false, settled: false })).toBe('pending')
  })

  // The real incident behind this: GitHub's REST release LISTING answered 504 for
  // every repo (reproduced against cli/cli too) while /releases/latest stayed up.
  // The visitor must be told the lookup broke and handed the link that still works,
  // not told the product hasn't shipped.
  it('is unreachable when the releases request failed', () => {
    expect(downloadState({ href: null, failed: true, settled: true })).toBe('unreachable')
  })

  // A successful fetch that carries no installer for this platform is a genuine gap
  // (a brand-new OS, or a release whose assets are still uploading), not an outage.
  it('is unsupported when the request succeeded but carried no installer', () => {
    expect(downloadState({ href: null, failed: false, settled: true })).toBe('unsupported')
  })

  // A failure that still produced a usable href (the cache answered, or a later retry
  // won) must not nag about an outage the visitor cannot see or act on.
  it('prefers a working download over reporting the failure', () => {
    expect(downloadState({ href: 'https://example.test/Surco.exe', failed: true })).toBe('ready')
  })
})
