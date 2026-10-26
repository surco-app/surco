import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS, type WantedCue } from '../shared/cueRules'
import { traktorContentId } from '../shared/traktorContent'
import type { CuesOp } from './rekordboxQueueOps'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { applyTraktorCuesBatch, withTraktorCues } from './traktorCuesWrite'

const KEY = 'Macintosh HD/:Users/:dj/:Music/:power.flac'
const ID = traktorContentId(KEY)
const GRID =
  '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="11.333358" LEN="0.000000" REPEATS="-1" HOTCUE="-1"><GRID BPM="128.000000"></GRID>\n</CUE_V2>'
const AUTOGRID =
  '<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="0" START="11.333358" LEN="0.000000" REPEATS="-1" HOTCUE="0" COLOR="#FFFFFF"></CUE_V2>'
const LOAD =
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="3" START="13739.225711" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>'
const BLUE =
  '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="92674.606740" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>'

const entry = (cues: string[]) =>
  `<ENTRY TITLE="The Power"><LOCATION DIR="/:Users/:dj/:Music/:" FILE="power.flac" VOLUME="Macintosh HD" VOLUMEID="v"></LOCATION>\n<INFO PLAYTIME="240" PLAYTIME_FLOAT="240.000000"></INFO>\n${cues.join('\n')}\n<STEMS STEMS="x"></STEMS>\n</ENTRY>`
const nml = (cues: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<NML VERSION="20"><COLLECTION ENTRIES="1">\n${entry(cues)}\n</COLLECTION></NML>\n`

const read = (doc: string) => readTraktorTrackCues(doc, ID)
const asWanted = (doc: string): WantedCue[] =>
  (read(doc)?.cues ?? []).map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
const block = (doc: string) => traktorEntryBlock(doc, KEY)?.block as string

const op = (
  doc: string,
  wanted: WantedCue[],
  fingerprint = read(doc)?.fingerprint ?? '',
): CuesOp => ({
  id: 'op1',
  kind: 'cues',
  contentId: ID,
  path: '/Users/dj/Music/power.flac',
  label: 'The Power',
  wanted,
  fingerprint,
})

async function onDisk(doc: string): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'surco-traktorcues-')), 'collection.nml')
  await writeFile(file, doc)
  return file
}

describe('withTraktorCues', () => {
  const doc = nml([GRID, AUTOGRID, LOAD, BLUE])

  it('leaves the entry byte for byte as it was when the set is saved as read', () => {
    expect(withTraktorCues(block(doc), asWanted(doc))).toBe(block(doc))
  })

  it('moves a blue cue and keeps the load cue, button 1 and the grid exactly as they were', () => {
    const moved = asWanted(doc).map((c) => (c.id === '3' ? { ...c, ms: 100000 } : c))
    const out = withTraktorCues(block(doc), moved)
    for (const kept of [GRID, AUTOGRID, LOAD]) expect(out).toContain(kept)
    expect(out).not.toContain('START="92674.606740"')
    expect(out).toContain(
      '<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="100000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>',
    )
    expect(out).toContain('<STEMS STEMS="x"></STEMS>')
  })

  it('adds a new cue as a normal Traktor cue on the button after AutoGrid', () => {
    const bare = nml([GRID, AUTOGRID])
    const out = withTraktorCues(block(bare), [{ ms: 60000, kind: HOT_KINDS[0], color: 5 }])
    expect(out).toContain('TYPE="0" START="60000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"')
    expect(out).toContain(GRID)
    expect(out).toContain(AUTOGRID)
  })

  it('writes a CALL as a cue without a button', () => {
    const out = withTraktorCues(block(nml([GRID])), [{ ms: 5000, kind: 0, color: null }])
    expect(out).toContain('START="5000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"')
  })

  it('adds cues to an entry that had none at all, before it closes', () => {
    const out = withTraktorCues(block(nml([])), [{ ms: 5000, kind: HOT_KINDS[1], color: 5 }])
    expect(out).toMatch(/HOTCUE="2"><\/CUE_V2>\n<\/ENTRY>$/)
  })

  it('removes a cue left out of the set', () => {
    const out = withTraktorCues(
      block(doc),
      asWanted(doc).filter((c) => c.id !== '3'),
    )
    expect(out).not.toContain('START="92674.606740"')
    expect(out).toContain(LOAD)
  })

  it('moves a cue to another button without touching its place', () => {
    const relettered = asWanted(doc).map((c) => (c.id === '3' ? { ...c, kind: HOT_KINDS[4] } : c))
    const out = withTraktorCues(block(doc), relettered)
    expect(out).toContain('START="92674.606740" LEN="0.000000" REPEATS="-1" HOTCUE="5"')
  })
})

describe('applyTraktorCuesBatch', () => {
  const doc = nml([GRID, AUTOGRID, LOAD, BLUE])

  it('writes nothing, and asks nothing, when the set is the one Traktor holds', async () => {
    const file = await onDisk(doc)
    const ensureClosed = vi.fn(async () => true)
    const write = vi.fn(async () => null)
    const result = await applyTraktorCuesBatch(file, [op(doc, asWanted(doc))], {
      ensureClosed,
      write,
    })
    expect(result).toMatchObject({ ok: true, wrote: false })
    expect(ensureClosed).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('writes the new set into the collection on disk', async () => {
    const file = await onDisk(doc)
    const wanted = [...asWanted(doc), { ms: 60000, kind: HOT_KINDS[2], color: 5 }]
    const result = await applyTraktorCuesBatch(file, [op(doc, wanted)], {
      ensureClosed: async () => true,
      write: async (path, text) => {
        await writeFile(path, text)
        return null
      },
    })
    expect(result).toMatchObject({ ok: true, wrote: true, outcomes: [{ applied: true }] })
    expect(read(await readFile(file, 'utf8'))?.cues.map((c) => c.ms)).toContain(60000)
  })

  it('drops cue H, which has no Traktor button, and says so', async () => {
    const file = await onDisk(doc)
    const wanted = [...asWanted(doc), { ms: 60000, kind: HOT_KINDS[7], color: 5 }]
    const result = await applyTraktorCuesBatch(file, [op(doc, wanted)], {
      ensureClosed: async () => true,
      write: async () => null,
    })
    expect(result).toMatchObject({
      ok: true,
      outcomes: [{ applied: true, notices: [{ code: 'cues-slot-dropped', track: 'The Power' }] }],
    })
  })

  it('refuses a set built on cues Traktor changed since', async () => {
    const file = await onDisk(doc)
    const result = await applyTraktorCuesBatch(file, [op(doc, asWanted(doc), 'stale')], {
      ensureClosed: async () => true,
    })
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: false, notices: [{ code: 'cues-changed' }] }],
    })
  })

  it('refuses a set that moves the DJ load cue', async () => {
    const file = await onDisk(doc)
    const moved = asWanted(doc).map((c) => (c.id === '2' ? { ...c, ms: 1 } : c))
    const result = await applyTraktorCuesBatch(file, [op(doc, moved)], {
      ensureClosed: async () => true,
    })
    expect(result).toMatchObject({
      outcomes: [{ applied: false, notices: [{ code: 'cues-invalid' }] }],
    })
  })

  it('refuses without a confirmed collection', async () => {
    expect(
      await applyTraktorCuesBatch('', [op(doc, asWanted(doc))], { ensureClosed: async () => true }),
    ).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('reports Traktor opening mid-write as busy, so the queue waits for it to close', async () => {
    const file = await onDisk(doc)
    const wanted = asWanted(doc).filter((c) => c.id !== '3')
    const result = await applyTraktorCuesBatch(file, [op(doc, wanted)], {
      ensureClosed: async () => true,
      write: async () => 'traktor-running',
    })
    expect(result).toEqual({ ok: false, reason: 'rekordbox-running' })
  })

  it('stops when the DJ declines to close Traktor', async () => {
    const file = await onDisk(doc)
    const wanted = asWanted(doc).filter((c) => c.id !== '3')
    const write = vi.fn(async () => null)
    const result = await applyTraktorCuesBatch(file, [op(doc, wanted)], {
      ensureClosed: async () => false,
      write,
    })
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses to rewrite an entry holding a cue it cannot read, rather than dropping that cue', async () => {
    const odd =
      '<CUE_V2 NAME="a>b" DISPL_ORDER="0" TYPE="0" START="5000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"/>'
    const strange = nml([GRID, odd, BLUE])
    const file = await onDisk(strange)
    const write = vi.fn(async () => null)
    const wanted = asWanted(strange).filter((c) => c.ms !== 92674.60674)
    const result = await applyTraktorCuesBatch(file, [op(strange, wanted)], {
      ensureClosed: async () => true,
      write,
    })
    expect(result).toMatchObject({
      ok: true,
      wrote: false,
      outcomes: [{ applied: false, notices: [{ code: 'cues-invalid' }] }],
    })
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a cue on the button an extra grid marker holds, so no button carries two cues', async () => {
    const marker =
      '<CUE_V2 NAME="Beat Marker" DISPL_ORDER="0" TYPE="4" START="50000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"><GRID BPM="128.000000"></GRID></CUE_V2>'
    const doc2 = nml([GRID, AUTOGRID, marker])
    const file = await onDisk(doc2)
    const wanted = [...asWanted(doc2), { ms: 60000, kind: HOT_KINDS[1], color: 5 }]
    const result = await applyTraktorCuesBatch(file, [op(doc2, wanted)], {
      ensureClosed: async () => true,
      write: async () => null,
    })
    expect(result).toMatchObject({
      outcomes: [{ applied: false, notices: [{ code: 'cues-invalid' }] }],
    })
  })
})
