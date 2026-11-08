import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TasteTrack } from '../shared/dropTaste'
import { createSharedEdits } from './cueTasteShared'

const track = (key: string): TasteTrack => ({
  key,
  candidates: [{ bar: 8, features: [1] }],
  drops: [8],
})

const dirs: string[] = []
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cue-taste-shared-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('createSharedEdits', () => {
  it('lets one Mac read what another saved in the settings folder', () => {
    const dir = folder()
    createSharedEdits(() => dir).write('mac-a', [track('x'), track('y')])
    expect(createSharedEdits(() => dir).readOthers('mac-b')).toEqual([track('x'), track('y')])
  })

  it('does not hand a Mac its own edits back as if they came from elsewhere', () => {
    const dir = folder()
    const shared = createSharedEdits(() => dir)
    shared.write('mac-a', [track('x')])
    shared.write('mac-b', [track('y')])
    expect(shared.readOthers('mac-a')).toEqual([track('y')])
  })

  it('does nothing without a settings folder, so Auto keeps learning on this Mac alone', () => {
    const shared = createSharedEdits(() => null)
    expect(() => shared.write('mac-a', [track('x')])).not.toThrow()
    expect(shared.readOthers('mac-b')).toEqual([])
  })

  it('skips a file another Mac left half written instead of losing the rest', () => {
    const dir = folder()
    const shared = createSharedEdits(() => dir)
    shared.write('mac-a', [track('x')])
    writeFileSync(join(dir, 'cue-taste', 'mac-c.json'), '{not json')
    expect(shared.readOthers('mac-b')).toEqual([track('x')])
  })

  it('leaves no temporary file behind that another Mac could read as an edit', () => {
    const dir = folder()
    createSharedEdits(() => dir).write('mac-a', [track('x')])
    expect(readdirSync(join(dir, 'cue-taste'))).toEqual(['mac-a.json'])
  })

  it('reads an empty folder as nothing to learn from', () => {
    const dir = folder()
    mkdirSync(join(dir, 'cue-taste'))
    expect(createSharedEdits(() => dir).readOthers('mac-a')).toEqual([])
  })
})
