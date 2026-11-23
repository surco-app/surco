import { mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { landOverTrashed } from './landOverTrashed'

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'surco-land-'))
  const original = join(dir, 'track.aiff')
  const tmp = join(dir, 'surco-tmp.aiff')
  writeFileSync(original, 'original')
  writeFileSync(tmp, 'new')
  return { dir, original, tmp }
}

// The DJ's track is the only copy there is once Copias had no room: whatever fails between
// the backup and the Trash, it has to end up back on its path, where every library points.
describe('landOverTrashed', () => {
  it('puts the original back when the rename never lands', async () => {
    const { dir, original, tmp } = folder()
    const trashed: string[] = []
    await expect(
      landOverTrashed(
        original,
        tmp,
        original,
        async () => {
          throw new Error('EPERM')
        },
        async (path) => {
          trashed.push(path)
        },
      ),
    ).rejects.toThrow('EPERM')
    expect(readFileSync(original, 'utf-8')).toBe('original')
    expect(trashed).toEqual([])
    expect(readdirSync(dir).sort()).toEqual(['surco-tmp.aiff', 'track.aiff'])
  })

  // A disk with no Trash refuses only once the new file is already in place, so both go
  // back: the original to its path, the new file to the temp the caller cleans up.
  it('puts both files back when the Trash refuses the original', async () => {
    const { dir, original, tmp } = folder()
    await expect(
      landOverTrashed(
        original,
        tmp,
        original,
        async () => renameSync(tmp, original),
        async () => {
          throw new Error('noRoomForBackup')
        },
      ),
    ).rejects.toThrow('noRoomForBackup')
    expect(readFileSync(original, 'utf-8')).toBe('original')
    expect(readFileSync(tmp, 'utf-8')).toBe('new')
    expect(readdirSync(dir).sort()).toEqual(['surco-tmp.aiff', 'track.aiff'])
  })

  it('trashes the original under its own name once the new file is on its path', async () => {
    const { dir, original, tmp } = folder()
    const trash = mkdtempSync(join(tmpdir(), 'surco-land-trash-'))
    await landOverTrashed(
      original,
      tmp,
      original,
      async () => renameSync(tmp, original),
      async (path) => renameSync(path, join(trash, 'track.aiff')),
    )
    expect(readFileSync(original, 'utf-8')).toBe('new')
    expect(readFileSync(join(trash, 'track.aiff'), 'utf-8')).toBe('original')
    expect(readdirSync(dir)).toEqual(['track.aiff'])
  })
})
