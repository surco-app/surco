import { describe, expect, it, vi } from 'vitest'
import { runReplaceFlow } from './replaceFlow'

// The whole substitution, in the one order that works. Apple Music lets a track's
// location be read but never written, so replacing a library copy is really "add the new
// one, delete the old one" — and once the old copy is gone, nothing can say which file it
// pointed at. rekordbox indexes by that path, so the old path has to be read while the
// entry still exists.

const OLD_MP3 = '/m/Acid/02 Everybody.mp3'
const NEW_AIFF = '/m/Acid/02 Everybody.aiff'

function deps(over: Partial<Parameters<typeof runReplaceFlow>[0]> = {}) {
  return {
    resolveTarget: vi.fn(async () => ({
      oldPath: OLD_MP3,
      rekordboxId: '900001',
      oldFileType: 1,
    })),
    convert: vi.fn(async () => NEW_AIFF),
    repoint: vi.fn(async () => ({ written: true as const, id: '900001' })),
    replaceInLibrary: vi.fn(async () => 'NEWPID'),
    ...over,
  }
}

describe('runReplaceFlow', () => {
  it('reports what it replaced and where', async () => {
    const d = deps()

    const result = await runReplaceFlow(d)

    expect(result).toEqual({
      replaced: true,
      oldPath: OLD_MP3,
      newPath: NEW_AIFF,
      repointed: true,
      persistentId: 'NEWPID',
    })
  })

  // The ordering the feature depends on. Reading the old location after the library copy
  // is replaced would return the NEW file — or nothing — and the repoint would either aim
  // at the file it was supposed to move away from, or never happen.
  it('reads the old location before it touches the library', async () => {
    const order: string[] = []
    const d = deps({
      resolveTarget: vi.fn(async () => {
        order.push('resolve')
        return { oldPath: OLD_MP3, rekordboxId: '900001', oldFileType: 1 }
      }),
      convert: vi.fn(async () => {
        order.push('convert')
        return NEW_AIFF
      }),
      repoint: vi.fn(async () => {
        order.push('repoint')
        return { written: true as const, id: '900001' }
      }),
      replaceInLibrary: vi.fn(async () => {
        order.push('library')
        return 'NEWPID'
      }),
    })

    await runReplaceFlow(d)

    expect(order).toEqual(['resolve', 'convert', 'repoint', 'library'])
  })

  // 117 of the user's library tracks are not in rekordbox. The replacement is still worth
  // doing; there is simply nothing to repoint.
  it('replaces without repointing when rekordbox does not have the track', async () => {
    const d = deps({
      resolveTarget: vi.fn(async () => ({
        oldPath: OLD_MP3,
        rekordboxId: null,
        oldFileType: null,
      })),
    })

    const result = await runReplaceFlow(d)

    expect(d.repoint).not.toHaveBeenCalled()
    expect(result).toMatchObject({ replaced: true, repointed: false })
  })

  // 34 files have two rekordbox rows. Repointing one would leave its twin on the replaced
  // file, so the replacement goes ahead and the choice is handed back to the caller.
  it('replaces but reports the ambiguity instead of guessing', async () => {
    const d = deps({
      resolveTarget: vi.fn(async () => ({
        oldPath: OLD_MP3,
        rekordboxId: null,
        oldFileType: null,
        ambiguous: ['900001', '900002'],
      })),
    })

    const result = await runReplaceFlow(d)

    expect(d.repoint).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      replaced: true,
      repointed: false,
      ambiguous: ['900001', '900002'],
    })
  })

  // A track with no library copy is a plain conversion: nothing is superseded, so nothing
  // is replaced and no old file is reported.
  it('converts without replacing when there is no library copy', async () => {
    const d = deps({ resolveTarget: vi.fn(async () => null) })

    const result = await runReplaceFlow(d)

    expect(d.replaceInLibrary).not.toHaveBeenCalled()
    expect(result).toEqual({ replaced: false, newPath: NEW_AIFF, repointed: false })
  })

  // The conversion is the step that produces the file everything else points at. If it
  // fails there is nothing to repoint to and nothing to put in the library, so the failure
  // has to stop the flow rather than leave the collection aimed at a file that was never
  // written.
  it('does not touch rekordbox or the library when the conversion fails', async () => {
    const d = deps({
      convert: vi.fn(async () => {
        throw new Error('encode failed')
      }),
    })

    await expect(runReplaceFlow(d)).rejects.toThrow('encode failed')
    expect(d.repoint).not.toHaveBeenCalled()
    expect(d.replaceInLibrary).not.toHaveBeenCalled()
  })

  // A refused repoint (rekordbox open, collection read-only) must not cost the user the
  // conversion they asked for: the file is already on disk and the library copy is still
  // worth updating. The reason travels up so the caller can say what did not happen.
  it('still replaces in the library when the repoint is refused', async () => {
    const d = deps({
      repoint: vi.fn(async () => ({
        written: false as const,
        reason: 'rekordbox-running' as const,
      })),
    })

    const result = await runReplaceFlow(d)

    expect(d.replaceInLibrary).toHaveBeenCalled()
    expect(result).toMatchObject({
      replaced: true,
      repointed: false,
      repointBlocked: 'rekordbox-running',
    })
  })
})
