import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUsbMemory, targetKey } from './usbExportMemory'

const entry = {
  playlistIds: ['2000'],
  trackIds: ['101', '102'],
  at: 1,
  pdb: { size: 9, mtimeMs: 2 },
  prune: false,
  settings: true,
}

describe('usb export memory', () => {
  // By identifier, never by name: Vicent's two sticks are both called "Vicent".
  it('keys sticks by identifier and folders by path', () => {
    expect(targetKey({ kind: 'volume', uuid: 'B10C' })).toBe('volume:B10C')
    expect(targetKey({ kind: 'folder', path: '/Volumes/SD/sets' })).toBe('folder:/Volumes/SD/sets')
  })

  it('remembers per stick, its boxes, and which was last, across restarts', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'usb-mem-')), 'usb-exports.json')
    createUsbMemory(file).remember('volume:A', entry)
    createUsbMemory(file).remember('volume:B', { ...entry, playlistIds: ['3000'], settings: false })
    const again = createUsbMemory(file)
    expect(again.get('volume:A')).toMatchObject({ playlistIds: ['2000'], settings: true })
    expect(again.get('volume:B')).toMatchObject({ playlistIds: ['3000'], settings: false })
    expect(again.last()).toBe('volume:B')
    expect(again.get('volume:C')).toBeNull()
  })

  // A broken file must not take the export down; it only forgets.
  it('starts empty from a missing or broken file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usb-mem-'))
    expect(createUsbMemory(join(dir, 'none.json')).last()).toBeNull()
    writeFileSync(join(dir, 'bad.json'), '{nope')
    expect(createUsbMemory(join(dir, 'bad.json')).get('volume:A')).toBeNull()
  })

  it('writes the whole file each time, never a half', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'usb-mem-')), 'usb-exports.json')
    createUsbMemory(file).remember('volume:A', entry)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      last: 'volume:A',
      entries: { 'volume:A': entry },
    })
  })
})
