import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))

import { measureBeatGrid } from './ffmpeg'
import { virtualdjTrackCuesOf } from './virtualdjCueSource'
import { parseVirtualdjDatabase } from './virtualdjDatabase'

const pray = process.env.SURCO_VIRTUALDJ_PRAY_DIR
const songs = parseVirtualdjDatabase(
  readFileSync(join(__dirname, 'virtualdjFixtures', 'database.xml'), 'utf8'),
)

describe.skipIf(!pray)('VirtualDJ’s grid against Surco’s on the real Pray files', () => {
  for (const ext of ['mp3', 'flac', 'wav', 'aiff', 'm4a'])
    it(`puts VirtualDJ’s first beat on Surco’s beat in Pray.${ext}, with no per-format shift`, async () => {
      const song = songs.find((s) => s.path.endsWith(`/Pray.${ext}`))
      if (!song || !pray) throw new Error(`no Pray.${ext}`)
      const first = virtualdjTrackCuesOf('virtualdj:pray', song).grid[0].ms
      const surco = await measureBeatGrid(join(pray, `Pray.${ext}`))
      if (!surco) throw new Error('Surco hears no beat')
      const period = 60000 / surco.bpm
      const nearest = surco.firstMs + Math.round((first - surco.firstMs) / period) * period
      expect(Math.abs(first - nearest)).toBeLessThan(10)
    }, 120000)
})
