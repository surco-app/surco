import { describe, expect, it, vi } from 'vitest'
import { buildFeedbackMailto, openFeedbackMail } from './feedback'

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
    const decoded = decodeURIComponent(
      buildFeedbackMailto({ version: '0.1.2', platform: 'darwin' }),
    )
    expect(decoded).not.toContain('Error:')
  })
})

describe('openFeedbackMail', () => {
  // The bug this module exists to fix: the mailto used to travel through
  // window.open → setWindowOpenHandler, which only lets http/https reach the OS.
  // A mailto: was dropped there in silence, so every report a user tried to send
  // was lost with no mail client, no window and no error. Opening it straight
  // from the main process is what keeps that from happening again.
  it('hands the mailto to the OS instead of the window-open guard', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    await openFeedbackMail({ version: '0.1.2', platform: 'darwin' }, openExternal)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal.mock.calls[0][0].startsWith('mailto:hello@vicent.io?')).toBe(true)
  })

  // A machine with no mail client rejects the open. Swallowing it keeps a failed
  // report from taking the whole IPC call down with an unhandled rejection.
  it('survives an OS with no mail client registered', async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error('no handler'))
    await expect(
      openFeedbackMail({ version: '0.1.2', platform: 'win32' }, openExternal),
    ).resolves.toBeUndefined()
  })
})
