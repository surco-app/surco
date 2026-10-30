import { describe, expect, it } from 'vitest'
import { VERIFY_DETAIL_KEYS } from '../../shared/verification'
import { CELLS, type Cell, groupsOf, qualitySettings } from './cells'

const layer = (name: Cell['layer']) => CELLS.filter((cell) => cell.layer === name)

const CLASS_OF: Record<string, string> = {
  'aiff>wav': 'keep',
  'flac>mp3': 'toLossy',
  'mp3n>aiff': 'fromLossy',
}
const DESTS = ['folder', 'beside', 'overwrite', 'appleMusic', 'appleMusicCopy']
const PROGRAMS = ['rekordbox', 'engine', 'traktor', 'music', 'all']
const STATES = ['closed', 'open', 'retry']
const CLASSES = ['keep', 'toLossy', 'fromLossy']
const toMusic = (dest: string) => dest.startsWith('appleMusic')

const KNOWN_OPEN = ['K05', 'K07', 'C-aiff-alac', 'C-flac-mp3', 'D12', 'D27', 'K09']

// The matrix is only worth its run time if a red cell today is the same cell tomorrow and
// the 131 combinations it claims are the ones it runs. These are fixed data, so the proof
// that they cover what the spec promises can be pure.
describe('the results matrix cells', () => {
  it('has 131 cells with unique ids', () => {
    expect(CELLS).toHaveLength(131)
    expect(new Set(CELLS.map((cell) => cell.id)).size).toBe(131)
    const counts = Object.fromEntries(
      (['C', 'D', 'Q', 'K', 'S'] as const).map((name) => [name, layer(name).length]),
    )
    expect(counts).toEqual({ C: 50, D: 28, Q: 12, K: 14, S: 27 })
    expect(layer('K').map((cell) => cell.id)).toEqual(
      Array.from({ length: 14 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`),
    )
  })

  it('crosses every origin with every format in layer C', () => {
    const pairs = new Set(layer('C').map((cell) => `${cell.origin}>${cell.target}`))
    expect(pairs.size).toBe(50)
  })

  // A pair of factors that never meet is a bug the matrix cannot see: Traktor with a folder
  // destination, or Music with the program left open, would ship untested.
  it('covers every pair of values of any two D factors', () => {
    const rows = layer('D').map((cell) => {
      const conversion = CLASS_OF[`${cell.origin}>${cell.target}`]
      expect(conversion, `${cell.id} converts outside the three classes`).toBeDefined()
      return [cell.dest, cell.programs, cell.state, conversion]
    })
    const seen = new Set<string>()
    for (const row of rows)
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) seen.add(`${i}=${row[i]}|${j}=${row[j]}`)
    const missing: string[] = []
    for (const dest of DESTS)
      for (const programs of PROGRAMS)
        for (const state of STATES)
          for (const conversion of CLASSES) {
            if (programs === 'music' && !toMusic(dest)) continue
            const row = [dest, programs, state, conversion]
            for (let i = 0; i < 4; i++)
              for (let j = i + 1; j < 4; j++) {
                const pair = `${i}=${row[i]}|${j}=${row[j]}`
                if (!seen.has(pair)) missing.push(pair)
              }
          }
    expect([...new Set(missing)]).toEqual([])
  })

  it('pins Traktor with a folder destination and beside it, so the matrix tells them apart', () => {
    const closedKeep = (dest: string) =>
      layer('D').find(
        (cell) =>
          cell.dest === dest &&
          cell.programs === 'traktor' &&
          cell.state === 'closed' &&
          CLASS_OF[`${cell.origin}>${cell.target}`] === 'keep',
      )
    expect(closedKeep('folder')).toBeDefined()
    expect(closedKeep('beside')).toBeDefined()
  })

  it('never sends FLAC to Music or Music to a non-Music destination', () => {
    for (const cell of CELLS) {
      if (toMusic(cell.dest)) expect(cell.target, cell.id).not.toBe('flac')
      if (cell.programs === 'music') expect(toMusic(cell.dest), cell.id).toBe(true)
    }
  })

  it('names a reachable detail key for every sabotage that is not a blind spot', () => {
    const sabotaged = layer('S')
    expect(sabotaged.every((cell) => cell.sabotage)).toBe(true)
    expect(CELLS.filter((cell) => cell.sabotage && cell.layer !== 'S')).toEqual([])
    const blind = sabotaged.filter((cell) => cell.expectBroken)
    const keyed = sabotaged.filter((cell) => !cell.expectBroken)
    expect(blind).toHaveLength(3)
    for (const cell of blind) {
      expect(cell.expectedKey, cell.id).toBeUndefined()
      expect(cell.expectBroken?.length, cell.id).toBeGreaterThan(0)
    }
    expect(keyed).toHaveLength(24)
    for (const cell of keyed) {
      expect(VERIFY_DETAIL_KEYS, cell.id).toContain(cell.expectedKey)
      expect(cell.sabotage, cell.id).toBe(cell.expectedKey)
    }
    expect(new Set(keyed.map((cell) => cell.expectedKey)).size).toBe(24)
    for (const cell of sabotaged.filter((c) => c.expectedKey?.startsWith('music')))
      expect(toMusic(cell.dest), cell.id).toBe(true)
  })

  // The core runs in every `npm test`: a cell red for a bug already known would leave the
  // normal suite red until that bug is fixed, which hides every new red behind it. No cell
  // copying to a folder and adding to Music comes out green yet, so that destination waits.
  it('keeps 16 cells in the core and none with a known open bug', () => {
    const core = CELLS.filter((cell) => cell.core)
    expect(core).toHaveLength(16)
    for (const cell of core) {
      expect(KNOWN_OPEN, cell.id).not.toContain(cell.id)
      expect(cell.expectBroken, cell.id).toBeUndefined()
    }
    const sabotages = core.flatMap((cell) => (cell.sabotage ? [cell.sabotage] : []))
    expect(sabotages.sort()).toEqual(
      [
        'filePcmDiffers',
        'fileTagDiffers',
        'rekordboxStillOld',
        'engineSizeDiffers',
        'traktorStillOld',
        'musicDuplicate',
      ].sort(),
    )
    const coreDests = new Set(core.map((cell) => cell.dest))
    for (const dest of DESTS.filter((d) => d !== 'appleMusicCopy'))
      expect(coreDests.has(dest as Cell['dest']), dest).toBe(true)
    const conversions = core
      .filter((cell) => cell.layer === 'C')
      .map((cell) => `${cell.origin}>${cell.target}`)
    expect(conversions.sort()).toEqual(['flac>aiff', 'aiff>wav', 'wav16>flac', 'mp3n>aiff'].sort())
    for (const id of ['K04', 'K10', 'K14']) expect(core.map((cell) => cell.id)).toContain(id)
  })

  // One openSurco per batch is how a DJ uses it (one batch, one flush) and what keeps the
  // full matrix in minutes.
  it('runs layer C as five batches of ten', () => {
    const groups = groupsOf(layer('C'))
    expect(groups).toHaveLength(5)
    for (const group of groups) {
      expect(group.cells).toHaveLength(10)
      expect(new Set(group.cells.map((cell) => cell.target)).size).toBe(1)
    }
  })

  // A sabotage or a regression's own fixture (an NFD row, twin rows, a name already taken)
  // would leak into every other track of a shared batch and judge them on a library they
  // were not built for.
  it('runs every sabotaged and every regression cell on its own', () => {
    const groups = groupsOf(CELLS)
    for (const cell of CELLS.filter((c) => c.sabotage || c.layer === 'K')) {
      const group = groups.find((g) => g.cells.includes(cell))
      expect(group?.cells, cell.id).toEqual([cell])
    }
    expect(groups.flatMap((g) => g.cells)).toHaveLength(131)
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })

  it('groups only cells that share how they are converted and where they go', () => {
    for (const group of groupsOf(CELLS)) {
      const shapes = new Set(
        group.cells.map((cell) =>
          JSON.stringify([
            cell.target,
            cell.dest,
            cell.programs,
            cell.state,
            cell.quality,
            cell.settings ?? null,
          ]),
        ),
      )
      expect(shapes.size, group.key).toBe(1)
    }
  })

  // Upconverting MP3 is off for every cell but the one that proves a kept MP3 is left
  // alone; a cell inheriting the user's default would test a different pipeline.
  it('keeps MP3 sources only in the cell that proves they are left alone', () => {
    for (const cell of CELLS) {
      const settings = { ...qualitySettings(cell.quality), ...cell.settings }
      expect(settings.keepMp3Sources, cell.id).toBe(cell.id === 'K13')
    }
  })

  // Twin rows are one file reached two ways; Surco must not pick one, so the row stays on
  // the old file and none points at the new one. Without declaring that, the cell could only
  // be green if Surco wrote a guess, the bug it exists to catch.
  it('expects the twin rows left alone and the ambiguity named', () => {
    const twins = CELLS.find((cell) => cell.id === 'K08')
    expect(twins?.expectedKey).toBe('rekordboxAmbiguous')
    expect(twins?.expectBroken?.map((b) => b.invariant)).toEqual(['points', 'unique'])
  })

  it('turns each quality into the settings that change the samples', () => {
    expect(qualitySettings('source')).toEqual({ keepMp3Sources: false })
    expect(qualitySettings('rate48')).toEqual({ keepMp3Sources: false, outputSampleRate: '48000' })
    expect(qualitySettings('bits16')).toEqual({ keepMp3Sources: false, outputBitDepth: '16' })
    expect(qualitySettings('normalize')).toEqual({
      keepMp3Sources: false,
      normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    })
    expect(qualitySettings('trim')).toEqual({ keepMp3Sources: false })
  })

  it('crosses four quality settings with three origins in layer Q', () => {
    const shapes = layer('Q').map((cell) => `${cell.quality} ${cell.origin}>${cell.target}`)
    expect(new Set(shapes).size).toBe(12)
    for (const cell of layer('Q')) {
      expect(['wav24>aiff', 'flac>flac', 'mp3n>wav']).toContain(`${cell.origin}>${cell.target}`)
      expect(cell.quality).not.toBe('source')
    }
  })

  it('names every cell in Spanish without an em dash or an explanatory colon', () => {
    for (const cell of CELLS) {
      expect(cell.name, cell.id).not.toMatch(/[—:]/)
      expect(cell.name.length, cell.id).toBeGreaterThan(0)
    }
    expect(new Set(CELLS.map((cell) => cell.name)).size).toBe(131)
  })
})
