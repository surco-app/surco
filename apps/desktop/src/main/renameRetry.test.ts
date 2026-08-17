import { describe, expect, it, vi } from 'vitest'
import { FILE_IN_USE_MARKER, isFileInUseError, renameWithRetry, rescuePath } from './renameRetry'

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
    expect(rename).toHaveBeenCalledTimes(6)
    // Backoff, not a busy loop: a scan needs time to finish, and hammering the
    // destination six times in a row would just fail six times in a row. Every step
    // in BACKOFF_MS is actually waited — the last one used to be skipped, halving the
    // window the comment advertises (1.5s instead of ~3.1s) exactly where it matters:
    // a Windows antivirus holding the destination through a big file.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 800, 1600])
  })

  // Pinned as a total, not just a shape: the window is the actual promise here — long
  // enough to outlast a scan, short enough that a bulk conversion doesn't look stuck on
  // one track. A step added or dropped changes that promise and should say so here.
  it('waits the documented ~3.1s across all attempts', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    await expect(renameWithRetry('/tmp/a.tmp', '/out/a.flac', { rename, sleep })).rejects.toThrow()
    const total = sleep.mock.calls.reduce((sum, [ms]) => sum + (ms as number), 0)
    expect(total).toBe(3100)
  })

  // The conversion is finished by the time the rename runs — audio, tags and cues are
  // all in the temp — so giving up must not throw that work away. convertAudio's catch
  // deletes the temp, which is right for a truncated ffmpeg output and catastrophic
  // here: the user loses a whole conversion because its cheapest step was blocked.
  // Landing it beside the intended output is what turns a lost job into a file to move.
  it('rescues the finished file when the destination never frees', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    await expect(
      renameWithRetry('/tmp/a.tmp', '/music/Song.flac', {
        rename,
        sleep: async () => {},
        rescue: () => '/music/Song~.flac',
      }),
    ).rejects.toThrow(FILE_IN_USE_MARKER)
    // The last call is the rescue: same temp, now aimed at the sibling name.
    expect(rename).toHaveBeenLastCalledWith('/tmp/a.tmp', '/music/Song~.flac')
  })

  // The rescue is a best effort on a volume that is already refusing writes. If it
  // fails too, the caller must still get the original file-in-use error rather than
  // whatever the rescue attempt threw — that error is what picks the translated message.
  it('still reports the original failure when the rescue cannot land either', async () => {
    // The rescue fails for an unrelated reason (read-only volume). Surfacing THAT error
    // would show the user a disk-space message for a file-in-use problem, and the
    // renderer picks its translated string off this very message.
    const rename = vi.fn().mockImplementation(async (_from: string, to: string) => {
      if (to === '/music/Song~.flac') throw inUse('EROFS')
      throw inUse('EPERM')
    })
    await expect(
      renameWithRetry('/tmp/a.tmp', '/music/Song.flac', {
        rename,
        sleep: async () => {},
        rescue: () => '/music/Song~.flac',
      }),
    ).rejects.toThrow(FILE_IN_USE_MARKER)
  })

  // Whether the rescue landed decides what the caller may do with the temp, and the
  // caller (convertAudio) deletes it on failure. Reporting a rescue that never happened
  // makes that delete throw away a finished conversion — the exact loss the rescue was
  // added to prevent — so the outcome has to be told, not assumed.
  it('reports that the work was rescued when the sibling rename lands', async () => {
    const rename = vi.fn().mockImplementation(async (_from: string, to: string) => {
      if (to === '/music/Song.flac') throw inUse('EPERM')
    })
    const err = await renameWithRetry('/tmp/a.tmp', '/music/Song.flac', {
      rename,
      sleep: async () => {},
      rescue: () => '/music/Song~.flac',
    }).catch((e: unknown) => e)
    expect((err as { rescuedTo?: string }).rescuedTo).toBe('/music/Song~.flac')
  })

  // A volume that refuses the destination often refuses the sibling too (read-only
  // remount, quota, the scanner holding the whole directory). The temp is then still
  // where it was, and saying otherwise would license the caller to delete it.
  it('does not claim a rescue when the sibling rename fails too', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    const err = await renameWithRetry('/tmp/a.tmp', '/music/Song.flac', {
      rename,
      sleep: async () => {},
      rescue: () => '/music/Song~.flac',
    }).catch((e: unknown) => e)
    expect((err as { rescuedTo?: string }).rescuedTo).toBeUndefined()
  })

  // Without a rescue path the behaviour is unchanged, so the Traktor and Engine
  // library writers — whose temps are disposable rewrites, not user work — keep
  // failing cleanly instead of littering the collection folder.
  it('does not rescue when the caller asks for none', async () => {
    const rename = vi.fn().mockRejectedValue(inUse('EPERM'))
    await expect(
      renameWithRetry('/tmp/a.tmp', '/music/Song.flac', { rename, sleep: async () => {} }),
    ).rejects.toThrow(FILE_IN_USE_MARKER)
    expect(rename).toHaveBeenCalledTimes(6)
    expect(rename.mock.calls.every(([, to]) => to === '/music/Song.flac')).toBe(true)
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
      attempt: 6,
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

// When the rename never succeeds, convertAudio used to delete the temp — throwing away
// a file whose audio, tags and cues were all already written, because the cheapest step
// of the whole conversion failed. The work is rescued under a visible name instead.
describe('rescuePath', () => {
  // The temp is hidden (leading dot) and carries a random suffix no one can recognise,
  // so keeping it as-is would hide the rescued work rather than hand it back. The name
  // has to sit beside the intended output and read as an obvious sibling of it. The
  // suffix stays wordless on purpose: main has no UI locale, and a translated word
  // landing in the wrong language reads as corruption.
  it('names the rescue after the intended output, visibly', () => {
    expect(rescuePath('/music/Song.flac')).toBe('/music/Song~.flac')
  })

  // Two blocked conversions of the same track must not collide: the second rescue would
  // overwrite the first, losing exactly the work this exists to save.
  it('does not collide when a rescue already exists', () => {
    const taken = new Set(['/music/Song~.flac'])
    // Disambiguated by the app's existing "keep both" convention (uniqueOutputPath),
    // not a second scheme invented here.
    expect(rescuePath('/music/Song.flac', (p) => taken.has(p))).toBe('/music/Song~ (2).flac')
  })

  // Names carrying dots ("Artist - Track 2.0.flac") must keep every one of them: only
  // the real extension is the split point.
  it('keeps dots inside the name and only splits the extension', () => {
    expect(rescuePath('/music/Track 2.0.flac')).toBe('/music/Track 2.0~.flac')
  })
})
