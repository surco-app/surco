import { describe, expect, it, vi } from 'vitest'
import { MAX_URL_LENGTH, buildIssueUrl, openFeedbackReport } from './feedback'

const ctx = { version: '0.1.2', platform: 'win32', error: 'ffmpeg exited 1' }

describe('buildIssueUrl', () => {
  // A mailto: only reaches a user who has a mail client configured, which on Windows
  // is the uncommon case — the report that started this ("on Windows nothing opens")
  // was exactly that. An https issue form opens in the browser everyone has.
  it('points at the project issue form over https', () => {
    const url = new URL(buildIssueUrl(ctx))
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('github.com')
    expect(url.pathname).toBe('/surco-app/surco/issues/new')
  })

  // The whole point of stamping version + OS: a report lands actionable without
  // the user (a DJ, not a tester) having to find out either.
  it('embeds version and OS', () => {
    const body = new URL(buildIssueUrl(ctx)).searchParams.get('body') ?? ''
    expect(body).toContain('0.1.2')
    expect(body).toContain('Windows')
  })

  it('includes the error when reporting a failure', () => {
    const url = buildIssueUrl(ctx)
    expect(new URL(url).searchParams.get('title')).toContain('ffmpeg exited 1')
    expect(new URL(url).searchParams.get('body')).toContain('ffmpeg exited 1')
  })

  it('omits the error section for plain feedback', () => {
    const body =
      new URL(buildIssueUrl({ version: '0.1.2', platform: 'darwin' })).searchParams.get('body') ?? ''
    expect(body).not.toContain('### Error')
    expect(body).toContain('macOS')
  })

  // Without a stack a "the app went blank" report says nothing. The crash screen has
  // one, the conversion-failure path does not, so it stays optional.
  it('includes the stack when there is one', () => {
    const body = new URL(buildIssueUrl({ ...ctx, stack: 'at foo (bar.js:1)' })).searchParams.get(
      'body',
    )
    expect(body).toContain('at foo (bar.js:1)')
  })

  it('includes the log lines when there are any', () => {
    const body = new URL(
      buildIssueUrl({ ...ctx, logLines: ['[error] audio:waveform failed'] }),
    ).searchParams.get('body')
    expect(body).toContain('audio:waveform failed')
  })

  // GitHub answers 414 past roughly 8 KB of URL, and the user would get a browser
  // error page instead of the issue form — worse than a shortened report.
  it('stays under the URL limit even with a huge log', () => {
    const logLines = Array.from({ length: 500 }, (_, i) => `[error] line ${i} ${'x'.repeat(200)}`)
    expect(buildIssueUrl({ ...ctx, logLines }).length).toBeLessThanOrEqual(MAX_URL_LENGTH)
  })

  // Truncation must stay visible, and the newest lines are the ones describing the
  // crash being reported.
  it('marks a truncated log and keeps the newest lines', () => {
    const logLines = Array.from({ length: 500 }, (_, i) => `[error] line ${i} ${'x'.repeat(200)}`)
    const body = new URL(buildIssueUrl({ ...ctx, logLines })).searchParams.get('body') ?? ''
    expect(body).toContain('line 499')
    expect(body).not.toContain('line 0 ')
    expect(body).toContain('log truncado')
  })
})

describe('openFeedbackReport', () => {
  // The bug this module exists to fix: the report used to travel through
  // window.open → setWindowOpenHandler, which only lets http/https reach the OS.
  // A mailto: was dropped there in silence, so every report a user tried to send
  // was lost with no window and no error. Opening it straight from the main process
  // is what keeps that from happening again.
  it('hands the issue URL to the OS instead of the window-open guard', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    await openFeedbackReport({ version: '0.1.2', platform: 'darwin' }, openExternal, async () => [])
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal.mock.calls[0][0].startsWith('https://github.com/')).toBe(true)
  })

  // The log is the richest part of a report, but an unreadable one (rotated away,
  // locked, on a disconnected volume) must not cost the user their report.
  it('still reports when the log cannot be read', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    await openFeedbackReport({ version: '0.1.2', platform: 'darwin' }, openExternal, async () => {
      throw new Error('log unreadable')
    })
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('survives an OS that refuses to open the browser', async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error('no handler'))
    await expect(
      openFeedbackReport({ version: '0.1.2', platform: 'win32' }, openExternal, async () => []),
    ).resolves.toBeUndefined()
  })
})
