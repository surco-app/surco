import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diskutilInfo } from './usbVolumes'

const bin = mkdtempSync(join(tmpdir(), 'surco-fake-diskutil-'))
const originalPath = process.env.PATH

beforeAll(() => {
  const fake = join(bin, 'diskutil')
  writeFileSync(fake, '#!/bin/sh\nexec sleep 30\n')
  chmodSync(fake, 0o755)
  process.env.PATH = `${bin}:${originalPath}`
})

afterAll(() => {
  process.env.PATH = originalPath
  rmSync(bin, { recursive: true, force: true })
})

describe('diskutilInfo', () => {
  it.skipIf(process.platform === 'win32')(
    'treats a volume diskutil never answers about as unknown, because a hung NAS mounted under /Volumes would otherwise keep the USB sticks from ever being listed',
    async () => {
      const started = Date.now()
      expect(await diskutilInfo('/Volumes/Public', 300)).toBeNull()
      expect(Date.now() - started).toBeLessThan(3000)
    },
  )
})
