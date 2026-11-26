import { describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))
vi.mock('./artworkCopies', () => ({ forgetArtworkCopy: async () => {} }))

import log from 'electron-log/main'
import {
  buildDeleteScript,
  buildSetFieldScript,
  deleteFromAppleMusic,
  runOsascript,
  setAppleMusicField,
} from './applemusic'

// Every call here would reach the real Music app through osascript; execFile answers instead,
// so no script ever runs and the DJ's library is never touched.
function answer(impl: (args: string[], opts: unknown) => { stdout: string } | unknown): void {
  execFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
    const done = cb as (err: unknown, out?: { stdout: string }) => void
    const result = impl(args, opts)
    if (result && typeof result === 'object' && 'stdout' in result)
      done(null, result as { stdout: string })
    else done(result)
  })
}

function scriptRun(): string {
  const args = execFile.mock.calls.at(-1)?.[1] as string[]
  return args[args.indexOf('-e') + 1]
}

describe('runOsascript', () => {
  it('runs the script through osascript with the caller options and answers its output', async () => {
    answer(() => ({ stdout: 'ABC123\n' }))
    expect(await runOsascript('return 1', { timeout: 5000 })).toBe('ABC123\n')
    const [cmd, args, opts] = execFile.mock.calls.at(-1) ?? []
    expect(cmd).toBe('osascript')
    expect(args).toEqual(['-e', 'return 1'])
    expect(opts).toEqual({ encoding: 'utf8', timeout: 5000 })
  })

  // Some reads are JXA, which only osascript's -l switch understands; passed as an exec
  // option it would be ignored and the script fail to compile as AppleScript.
  it('runs a JavaScript script with the language switch, not as an exec option', async () => {
    answer(() => ({ stdout: '' }))
    await runOsascript('Application("Music")', { language: 'JavaScript', maxBuffer: 10 })
    const [, args, opts] = execFile.mock.calls.at(-1) ?? []
    expect(args).toEqual(['-l', 'JavaScript', '-e', 'Application("Music")'])
    expect(opts).toEqual({ encoding: 'utf8', maxBuffer: 10 })
  })

  // execFile's own message is "Command failed: osascript -e <the whole script>": shown to
  // the DJ it buries the one line that says what Music refused. The script still goes to
  // the log, which is the only place it names what to fix.
  it('fails with Music’s own reason and keeps the script for the log only', async () => {
    const logged = vi.spyOn(log, 'error').mockImplementation(() => {})
    answer(() =>
      Object.assign(new Error('Command failed: osascript -e tell application "Music"…'), {
        stderr: '120:180: execution error: Music got an error: AppleEvent timed out. (-1712)\n',
      }),
    )
    const err = await runOsascript('tell application "Music" to play').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(
      'execution error: Music got an error: AppleEvent timed out. (-1712)',
    )
    expect(logged).toHaveBeenCalledWith(
      'osascript failed',
      'execution error: Music got an error: AppleEvent timed out. (-1712)',
      expect.any(String),
      'tell application "Music" to play',
    )
  })

  it('keeps the original error when osascript said nothing on stderr', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {})
    const spawnFailure = Object.assign(new Error('spawn osascript ENOENT'), { stderr: '  ' })
    answer(() => spawnFailure)
    await expect(runOsascript('return 1')).rejects.toBe(spawnFailure)
  })

  it('turns a failure that is not an Error into one, so callers can always read a message', async () => {
    vi.spyOn(log, 'error').mockImplementation(() => {})
    answer(() => 'killed')
    const err = await runOsascript('return 1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('killed')
  })
})

describe('setAppleMusicField', () => {
  // The Music review writes one field and reads back what happened, so the row can say
  // whether it took, was already so, or the entry moved on under it.
  it.each(['set', 'held', 'missing', 'mismatch'] as const)(
    'answers %s when Music says so',
    async (result) => {
      answer(() => ({ stdout: `${result}\n` }))
      expect(await setAppleMusicField('ABCDEF0123456789', 'genre', 'House', 'Techno')).toBe(result)
      expect(scriptRun()).toBe(
        buildSetFieldScript('ABCDEF0123456789', 'genre', 'House', 'Techno', undefined),
      )
    },
  )

  it('runs the script for the entry and the file the review is looking at', async () => {
    answer(() => ({ stdout: 'set' }))
    await setAppleMusicField('ABCDEF0123456789', 'year', '1999', '2001', '/Music/a.m4a')
    expect(scriptRun()).toBe(
      buildSetFieldScript('ABCDEF0123456789', 'year', '1999', '2001', '/Music/a.m4a'),
    )
  })

  // Anything else means the script did something nobody planned for; counting it as set
  // would tell the DJ the library changed when nobody knows that it did.
  it('fails on an answer it does not know', async () => {
    answer(() => ({ stdout: 'oops\n' }))
    await expect(setAppleMusicField('ABCDEF0123456789', 'genre', 'a', 'b')).rejects.toThrow(
      'unexpected Music answer: oops',
    )
  })
})

describe('deleteFromAppleMusic', () => {
  it('answers the deleted entry’s file, so the caller can move it to the bin', async () => {
    answer(() => ({ stdout: 'deleted\t/Music/Media/a.m4a\n' }))
    expect(await deleteFromAppleMusic('ABCDEF0123456789', 'Artist - Song')).toBe(
      '/Music/Media/a.m4a',
    )
    expect(scriptRun()).toBe(buildDeleteScript('ABCDEF0123456789', 'Artist - Song', undefined))
  })

  it('answers an empty path when Music held no reachable file for the entry', async () => {
    answer(() => ({ stdout: 'deleted\n' }))
    expect(await deleteFromAppleMusic('ABCDEF0123456789', 'Artist - Song')).toBe('')
  })

  it('answers null when the entry was already gone', async () => {
    answer(() => ({ stdout: 'missing\n' }))
    expect(await deleteFromAppleMusic('ABCDEF0123456789', 'Artist - Song')).toBeNull()
  })

  // The snapshot the DJ confirmed no longer matches the live entry: nothing was deleted,
  // and the renderer must be able to say so across the IPC boundary.
  it('fails with the sentinel the renderer recognises when the entry no longer matches', async () => {
    answer(() => ({ stdout: 'mismatch\n' }))
    await expect(
      deleteFromAppleMusic('ABCDEF0123456789', 'Artist - Song', '/Music/a.m4a'),
    ).rejects.toThrow('applemusic-delete-mismatch')
    expect(scriptRun()).toBe(buildDeleteScript('ABCDEF0123456789', 'Artist - Song', '/Music/a.m4a'))
  })
})
