import { describe, expect, it } from 'vitest'
import { cleanIpcError, isFileInUseMessage } from './ipcError'

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
