import { describe, expect, it, vi } from 'vitest'
import { FILE_IN_USE_MARKER, isFileInUseError, renameWithRetry } from './renameRetry'

const inUse = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

describe('isFileInUseError', () => {
  // The three codes Windows raises when another process holds the destination open.
  // Anything else is a real failure (missing dir, read-only volume) that retrying
  // would only delay.
  it('recognises the codes a held file raises', () => {
    expect(isFileInUseError(inUse('EPERM'))).toBe(true)
    expect(isFileInUseError(inUse('EBUSY'))).toBe(true)
    expect(isFileInUseError(inUse('EACCES'))).toBe(true)
  })

  it('rejects failures that retrying cannot fix', () => {
    expect(isFileInUseError(inUse('ENOENT'))).toBe(false)
    expect(isFileInUseError(inUse('ENOSPC'))).toBe(false)
    expect(isFileInUseError(new Error('no code at all'))).toBe(false)
  })
})

describe('renameWithRetry', () => {
  // The bug this exists for: a Windows antivirus (or indexer, or player) holds the
  // destination open for a few hundred ms right after it is written. The rename hit
  // that window, threw EPERM, and convertAudio's catch deleted the finished temp —
  // losing a conversion whose audio, tags and cues were all already correct.
  it('survives a destination held open for the first attempts', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(inUse('EPERM'))
      .mockRejectedValueOnce(inUse('EPERM'))
      .mockResolvedValueOnce(undefined)
    await renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep: async () => {} })
    expect(rename).toHaveBeenCalledTimes(3)
  })

  // A held file that never frees still has to fail, or a conversion would hang
  // forever waiting on a lock nobody is going to drop. The marker rides in the
  // message because Electron's IPC drops every other property of a rejection —
  // without it the renderer could only show the raw EPERM text.
  it('gives up after the last attempt and marks the failure as file-in-use', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep })).rejects.toThrow(
      FILE_IN_USE_MARKER,
    )
    expect(rename).toHaveBeenCalledTimes(5)
    // Backoff, not a busy loop: a scan needs time to finish, and hammering the
    // destination five times in a row would just fail five times in a row.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 800])
  })

  // Retrying a missing directory or a full disk only delays the error the caller
  // has to show anyway.
  it('fails immediately on an error retrying cannot fix', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('ENOSPC'))
    await expect(
      renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(rename).toHaveBeenCalledTimes(1)
  })

  // Only a genuinely held file gets the marker: tagging a full disk with it would
  // tell the user to close a program that has nothing to do with the failure.
  it('leaves an unrelated failure unmarked', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('ENOSPC'))
    await expect(
      renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep: async () => {} }),
    ).rejects.not.toThrow(FILE_IN_USE_MARKER)
  })

  it('does not sleep when the first attempt succeeds', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    await renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep })
    expect(rename).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  // Field diagnosis, not decoration: this bug only reproduces on Windows machines we
  // cannot attach a debugger to, so the log has to answer "was the file still held,
  // and for how long" on its own. A report that says "it failed" without these numbers
  // is what sent the previous fix out unverified.
  it('reports each blocked attempt so the log can prove the file was held', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(inUse('EPERM'))
      .mockRejectedValueOnce(inUse('EBUSY'))
      .mockResolvedValueOnce(undefined)
    const onRetry = vi.fn()
    await renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep: async () => {}, onRetry })
    expect(onRetry.mock.calls.map(([info]) => info)).toEqual([
      { attempt: 1, code: 'EPERM', waitMs: 100, path: '/out/a.flac' },
      { attempt: 2, code: 'EBUSY', waitMs: 200, path: '/out/a.flac' },
    ])
  })

  // The give-up path is the one a user actually reports, so it must be the loudest:
  // without a final record the log would show four retries and then silence, leaving
  // "did it eventually land?" unanswerable.
  it('reports the give-up separately from the retries', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    const onRetry = vi.fn()
    await expect(
      renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep: async () => {}, onRetry }),
    ).rejects.toThrow(FILE_IN_USE_MARKER)
    expect(onRetry.mock.calls.map(([info]) => info).at(-1)).toEqual({
      attempt: 5,
      code: 'EPERM',
      waitMs: null,
      path: '/out/a.flac',
    })
  })

  // A rename that lands first try is the common case; logging it would bury the
  // interesting events under one line per converted track in a bulk run.
  it('stays silent when nothing blocked the rename', async () => {
    const onRetry = vi.fn()
    await renameWithRetry('/tmp/a.tmp', '/out/a.flac', {
      rename: vi.fn().mockResolvedValue(undefined),
      sleep: async () => {},
      onRetry,
    })
    expect(onRetry).not.toHaveBeenCalled()
  })
})
