import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const listed: string[] = []
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: (async (path: string) => {
      listed.push(path)
      return actual.readdir(path)
    }) as typeof actual.readdir,
  }
})

import { fileReaders } from './verifyFile'

const dir = mkdtempSync(join(tmpdir(), 'surco-verifyfind-'))

beforeEach(() => {
  listed.length = 0
})

// An output folder on a NAS can hold thousands of tracks: listing it for every check
// costs far more than asking for the one file.
describe('fileReaders.exists', () => {
  it('finds a file that is there without listing its folder', async () => {
    const file = join(dir, 'there.wav')
    writeFileSync(file, '')
    expect(await fileReaders.exists(file)).toBe(file)
    expect(listed).toEqual([])
  })

  it('finds a file whose name is stored in another Unicode form', async () => {
    const nfd = join(dir, 'Café.wav')
    writeFileSync(nfd, '')
    expect(await fileReaders.exists(join(dir, 'Café.wav'))).not.toBeNull()
  })

  it('lists the folder when the name as asked is not found', async () => {
    expect(await fileReaders.exists(join(dir, 'gone.wav'))).toBeNull()
    expect(listed).toEqual([dir])
  })
})
