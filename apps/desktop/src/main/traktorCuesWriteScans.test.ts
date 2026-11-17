import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { traktorContentId } from '../shared/traktorContent'
import type { CuesOp } from './rekordboxQueueOps'
import { createSessionBackup } from './rekordboxSessionBackup'

const scans = vi.hoisted(() => ({ count: 0 }))

vi.mock('./traktorProcess', () => ({ isTraktorRunning: vi.fn().mockResolvedValue(false) }))
vi.mock('./traktorNml', async (importOriginal) => {
  const real = await importOriginal<typeof import('./traktorNml')>()
  return {
    ...real,
    findEntries: (...args: Parameters<typeof real.findEntries>) => {
      scans.count += 1
      return real.findEntries(...args)
    },
  }
})

const { readTraktorTrackCues } = await import('./traktorCues')
const { applyTraktorBatch } = await import('./traktorCuesWrite')

const keyOf = (file: string) => `Macintosh HD/:Users/:dj/:Music/:${file}`
const entry = (file: string) =>
  `<ENTRY TITLE="${file}"><LOCATION DIR="/:Users/:dj/:Music/:" FILE="${file}" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION>\n<INFO PLAYTIME="240" PLAYTIME_FLOAT="240.000000"></INFO>\n<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="92674.606740" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>\n</ENTRY>`
const FILES = ['a.flac', 'b.flac', 'c.flac', 'd.flac']
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="${FILES.length}">\n${FILES.map(entry).join('\n')}\n</COLLECTION></NML>\n`

const clearing = (file: string): CuesOp => {
  const contentId = traktorContentId(keyOf(file))
  return {
    id: `op-${file}`,
    kind: 'cues',
    contentId,
    path: `/Users/dj/Music/${file}`,
    label: file,
    wanted: [],
    fingerprint: readTraktorTrackCues(DOC, contentId)?.fingerprint ?? '',
  }
}

async function save(
  files: string[],
): Promise<{ written: string; scans: number; applied: boolean[] }> {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-traktorscans-')), 'collection.nml')
  await writeFile(path, DOC)
  const ops = files.map(clearing)
  scans.count = 0
  const result = await applyTraktorBatch(path, ops, {
    ensureClosed: async () => true,
    session: createSessionBackup({}),
    bootVolume: 'Macintosh HD',
  })
  return {
    written: await readFile(path, 'utf8'),
    scans: scans.count,
    applied: result.ok ? result.outcomes.map((o) => o.applied) : [],
  }
}

describe('applyTraktorBatch over many tracks', () => {
  it('walks the collection the same few times for one track as for four, since walking it again for every track froze a save of a few hundred for half a minute', async () => {
    const one = await save(['a.flac'])
    const four = await save(FILES)
    expect(four.applied).toEqual([true, true, true, true])
    expect(four.written).not.toContain('HOTCUE="2"')
    expect(one.written.match(/HOTCUE="2"/g)).toHaveLength(3)
    expect(four.scans).toBe(one.scans)
  })
})
