import { describe, expect, it } from 'vitest'
import { buildFeedbackMailto } from './feedback'

describe('buildFeedbackMailto', () => {
  // The whole point of stamping version + OS: a report lands actionable without
  // the user (a DJ, not a tester) having to find out either.
  it('addresses the feedback inbox and embeds version and OS', () => {
    const url = buildFeedbackMailto({ version: '0.1.2', platform: 'darwin' })
    expect(url.startsWith('mailto:hello@vicent.io?')).toBe(true)
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('0.1.2')
    expect(decoded).toContain('macOS')
  })

  it('includes the error when reporting a failure', () => {
    const url = buildFeedbackMailto({
      version: '0.1.2',
      platform: 'win32',
      error: 'ffmpeg exited 1',
    })
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('Windows')
    expect(decoded).toContain('ffmpeg exited 1')
  })

  it('omits the error line for plain feedback', () => {
    const decoded = decodeURIComponent(buildFeedbackMailto({ version: '0.1.2', platform: 'darwin' }))
    expect(decoded).not.toContain('Error:')
  })
})
