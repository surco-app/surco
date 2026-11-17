import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TrackCues } from '../shared/types'
import type { CuesOp } from './rekordboxQueueOps'

const parses = vi.hoisted(() => ({ count: 0 }))

vi.mock('./virtualdjDatabase', async (importOriginal) => {
  const real = await importOriginal<typeof import('./virtualdjDatabase')>()
  return {
    ...real,
    parseVirtualdjDatabase: (...args: Parameters<typeof real.parseVirtualdjDatabase>) => {
      parses.count += 1
      return real.parseVirtualdjDatabase(...args)
    },
  }
})

const { virtualdjCueSource } = await import('./virtualdjCueSource')
const { applyVirtualdjCuesBatch } = await import('./virtualdjCuesWrite')

const FILES = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'].map((f) => `/Music/${f}`)
const song = (path: string) =>
  ` <Song FilePath="${path}" FileSize="100" Flag="268435456">\r\n  <Infos SongLength="200.0" />\r\n  <Poi Name="Surco" Pos="30.0" Num="1" Type="cue" />\r\n </Song>`
const DOC = `<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n${FILES.map(song).join('\r\n')}\r\n</VirtualDJ_Database>\r\n`

async function save(
  files: string[],
): Promise<{ written: string; parses: number; applied: boolean[] }> {
  const base = mkdtempSync(join(tmpdir(), 'surco-vdj-scans-'))
  const dir = join(base, 'VirtualDJ')
  mkdirSync(dir)
  writeFileSync(join(dir, 'database.xml'), DOC)
  const roots = () => [{ dir, root: '/' }]
  const reader = virtualdjCueSource(
    {
      roots,
      words: async () => null,
      beatGrid: async () => null,
      queue: { enqueue: vi.fn(), cuesOp: vi.fn(), drop: vi.fn() },
      applyQuietly: vi.fn(),
    },
    () => '',
  )
  const ops: CuesOp[] = []
  for (const path of files) {
    const read = (await reader.trackCues(`virtualdj:${path}`)) as TrackCues
    ops.push({
      id: `op-${path}`,
      kind: 'cues',
      contentId: `virtualdj:${path}`,
      path,
      label: path,
      wanted: [],
      fingerprint: read.fingerprint,
    })
  }
  parses.count = 0
  const result = await applyVirtualdjCuesBatch(ops, {
    backupDir: join(base, 'virtualdj-backups'),
    roots,
    virtualdjOpen: async () => false,
    ensureClosed: async () => true,
  })
  return {
    written: readFileSync(join(dir, 'database.xml'), 'utf8'),
    parses: parses.count,
    applied: result.ok ? result.outcomes.map((o) => o.applied) : [],
  }
}

describe('applyVirtualdjCuesBatch over many tracks', () => {
  it('reads the database through the same few times for one track as for four, since reading it again for every track made a save of thousands take many minutes', async () => {
    const one = await save(FILES.slice(0, 1))
    const four = await save(FILES)
    expect(four.applied).toEqual([true, true, true, true])
    expect(four.written).not.toContain('Type="cue"')
    expect(four.written).toBe(
      DOC.replaceAll('  <Poi Name="Surco" Pos="30.0" Num="1" Type="cue" />\r\n', ''),
    )
    expect(one.written.match(/Type="cue"/g)).toHaveLength(3)
    expect(four.parses).toBe(one.parses)
  })
})
