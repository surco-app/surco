import { describe, expect, it } from 'vitest'
import { cleanIpcError, errorKeyOf, isFileInUseMessage, mainErrorMessage } from './ipcError'

const IPC_PREFIX = "Error invoking remote method 'track:process': Error: "

describe('cleanIpcError', () => {
  it('peels the Electron IPC plumbing prefix', () => {
    expect(cleanIpcError(`${IPC_PREFIX}ffmpeg exited 1`)).toBe('ffmpeg exited 1')
  })

  it('leaves a message that carries no prefix alone', () => {
    expect(cleanIpcError('ffmpeg exited 1')).toBe('ffmpeg exited 1')
  })
})

describe('isFileInUseMessage', () => {
  // The Windows failure this exists for: another program (antivirus, indexer, a
  // player) holds the destination open, so the rename over it is refused. Electron's
  // IPC drops the error's `code`, so the marker in the message text is the only thing
  // that survives to tell the renderer to explain the real cause instead of showing
  // "EPERM: operation not permitted" to a DJ.
  it('recognises a held-file failure through the IPC prefix', () => {
    const raw = `${IPC_PREFIX}SURCO_FILE_IN_USE: EPERM: operation not permitted, rename 'D:\\a.tmp' -> 'D:\\a.flac'`
    expect(isFileInUseMessage(cleanIpcError(raw))).toBe(true)
  })

  // An ordinary conversion failure must keep its own message: telling someone to
  // close another program when the disk is full sends them chasing the wrong thing.
  it('does not claim an unrelated failure is a held file', () => {
    expect(isFileInUseMessage(cleanIpcError(`${IPC_PREFIX}ffmpeg exited 1`))).toBe(false)
    expect(isFileInUseMessage('ENOSPC: no space left on device')).toBe(false)
  })
})

// The main process has no i18next instance, so an error it throws cannot be phrased in
// the user's language where it happens. Eight of them were written in Spanish and shown
// verbatim to everyone — a German DJ hitting the Discogs rate limit read a Spanish
// sentence. Same trick as the file-in-use marker above, generalized: main stamps a
// stable key, the renderer resolves it against its own catalogue.
describe('errorKeyOf', () => {
  it('reads the key a main-process error stamped, through the IPC prefix', () => {
    expect(errorKeyOf(cleanIpcError(`${IPC_PREFIX}SURCO_ERR:discogsRateLimit`))).toBe(
      'discogsRateLimit',
    )
  })

  it('reads a key that carries trailing detail', () => {
    expect(errorKeyOf('SURCO_ERR:coverUrlBlocked: https://evil.example/x.jpg')).toBe(
      'coverUrlBlocked',
    )
  })

  // Anything not stamped keeps its own text: ffmpeg's own stderr is more useful to a
  // bug report than a generic "processing failed".
  it('returns null for a message that carries no key', () => {
    expect(errorKeyOf('ffmpeg exited 1')).toBeNull()
    expect(errorKeyOf('')).toBeNull()
  })

  // The marker is matched at the start, so a filename that happens to contain the
  // prefix cannot make an unrelated failure claim to be a known error.
  it('ignores the marker when it is not what the message starts with', () => {
    expect(errorKeyOf('ENOENT: no such file, open /music/SURCO_ERR:fake.wav')).toBeNull()
  })
})

// What every surface showing a main-process failure calls: peel the IPC plumbing,
// resolve a stamped key against the catalogue, and otherwise keep the raw text.
describe('mainErrorMessage', () => {
  const translate = (key: string): string => `translated:${key}`

  it('translates a stamped error, prefix and all', () => {
    const e = new Error(`${IPC_PREFIX}SURCO_ERR:discogsToken`)
    expect(mainErrorMessage(e, translate, 'fallback')).toBe('translated:errors.discogsToken')
  })

  // ffmpeg's own stderr is worth more in a bug report than a generic sentence, so an
  // unstamped failure keeps its text — just without the Electron prefix.
  it('keeps an unstamped message, minus the plumbing', () => {
    const e = new Error(`${IPC_PREFIX}ffmpeg exited 1`)
    expect(mainErrorMessage(e, translate, 'fallback')).toBe('ffmpeg exited 1')
  })

  // A rejection that is not an Error at all (or carries no message) has nothing to
  // show, so the caller's own wording stands in.
  it('falls back when there is no message to show', () => {
    expect(mainErrorMessage('not an error', translate, 'fallback')).toBe('fallback')
    expect(mainErrorMessage(new Error(''), translate, 'fallback')).toBe('fallback')
  })
})
