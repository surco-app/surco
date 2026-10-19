import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CALLS_ONLY, MY_FLOW, ONE_AT_32 } from '../shared/cueFlows'
import type { RekordboxQueueState } from '../shared/types'
import { anlzFile, pqtzSection } from './anlzFixture'
import { completableOps, completeOnClose } from './rekordboxCompleteOnClose'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import type { RekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)

async function collection(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbcomplete-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      ['101', '102', '103'].includes(c.ID) ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
    cueRows: [
      { ID: '11', ContentID: '101', InMsec: 128000, Kind: 0, ColorTableIndex: null },
      { ID: '12', ContentID: '102', InMsec: 128000, Kind: 0, ColorTableIndex: null },
      { ID: '13', ContentID: '102', InMsec: 1000, Kind: 1, ColorTableIndex: 32 },
      { ID: '14', ContentID: '104', InMsec: 128000, Kind: 0, ColorTableIndex: null },
    ],
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
  return path
}

const EMPTY: RekordboxQueueState = { tracks: 0, changes: 0, items: [] }

function queue(state: RekordboxQueueState = EMPTY, queued: Record<string, CuesOp> = {}) {
  return {
    enqueue: vi.fn<RekordboxQueue['enqueue']>(),
    cuesOp: vi.fn<RekordboxQueue['cuesOp']>((id) => queued[id]),
    state: vi.fn<RekordboxQueue['state']>(() => state),
  }
}

describe('completableOps', () => {
  it('completes only tracks with drops, no hot cue at all and a grid, the only ones fits_plan can never refuse', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    const ops = completableOps(db, join(path, '../share'), MY_FLOW, () => 'op')
    expect(ops).toEqual([
      {
        id: 'op',
        kind: 'cues',
        contentId: '101',
        path: '/Volumes/Public/Music/Night Train.aiff',
        label: 'Night Train',
        wanted: [
          { id: '11', ms: 128000, kind: 0, color: null },
          { ms: 32000, kind: 1, color: 42 },
          { ms: 32000, kind: 0, color: null },
          { ms: 64000, kind: 2, color: 22 },
          { ms: 64000, kind: 0, color: null },
          { ms: 96000, kind: 3, color: 1 },
          { ms: 96000, kind: 0, color: null },
        ],
        fingerprint: '11|0|128000|',
      },
    ])
    db.close()
  })

  it('completes with the flow the DJ chose, one green cue at 32 bars and no CALL under it', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    expect(completableOps(db, join(path, '../share'), ONE_AT_32, () => 'op')[0].wanted).toEqual([
      { id: '11', ms: 128000, kind: 0, color: null },
      { ms: 64000, kind: 1, color: 22 },
    ])
    db.close()
  })

  it('has nothing to complete with Solo CALL, since the drops already are the CALLs', async () => {
    const path = await collection()
    const db = openRekordboxDb(path, { readonly: true })
    if (!db) throw new Error('did not open')
    expect(completableOps(db, join(path, '../share'), CALLS_ONLY)).toEqual([])
    db.close()
  })
})

describe('completeOnClose', () => {
  it('queues the completion of the collection it reads when the option is on', async () => {
    const path = await collection()
    const q = queue()
    completeOnClose({ enabled: () => true, collection: () => path, queue: q, flow: () => MY_FLOW })
    expect(q.enqueue).toHaveBeenCalledWith([expect.objectContaining({ contentId: '101' })])
  })

  it('queues the set of the flow it is given, not the fixed one', async () => {
    const path = await collection()
    const q = queue()
    completeOnClose({
      enabled: () => true,
      collection: () => path,
      queue: q,
      flow: () => ONE_AT_32,
    })
    expect(q.enqueue).toHaveBeenCalledWith([
      expect.objectContaining({
        wanted: [
          { id: '11', ms: 128000, kind: 0, color: null },
          { ms: 64000, kind: 1, color: 22 },
        ],
      }),
    ])
  })

  it('never replaces cues the user queued for a track, since enqueue swaps an op with the same key', async () => {
    const path = await collection()
    const mine: CuesOp = {
      id: 'mine',
      kind: 'cues',
      contentId: '101',
      path: '/Volumes/Public/Music/Night Train.aiff',
      label: 'Night Train',
      wanted: [{ id: '11', ms: 128000, kind: 0, color: null }],
      fingerprint: '11|0|128000|',
    }
    const q = queue(EMPTY, { '101': mine })
    completeOnClose({ enabled: () => true, collection: () => path, queue: q, flow: () => MY_FLOW })
    expect(q.enqueue).not.toHaveBeenCalled()
  })

  it('adds nothing to a halted queue, whose next write would replace the only good backup', async () => {
    const path = await collection()
    const q = queue({ ...EMPTY, halted: true })
    completeOnClose({ enabled: () => true, collection: () => path, queue: q, flow: () => MY_FLOW })
    expect(q.enqueue).not.toHaveBeenCalled()
  })

  it('adds nothing to a queue held for another collection', async () => {
    const path = await collection()
    const q = queue({ ...EMPTY, elsewhere: true })
    completeOnClose({ enabled: () => true, collection: () => path, queue: q, flow: () => MY_FLOW })
    expect(q.enqueue).not.toHaveBeenCalled()
  })

  it('does nothing when the option is off, which is the default', async () => {
    const path = await collection()
    const q = queue()
    completeOnClose({ enabled: () => false, collection: () => path, queue: q, flow: () => MY_FLOW })
    expect(q.enqueue).not.toHaveBeenCalled()
  })

  it('does nothing without a collection and survives one that cannot be opened', () => {
    const q = queue()
    completeOnClose({ enabled: () => true, collection: () => '', queue: q, flow: () => MY_FLOW })
    completeOnClose({
      enabled: () => true,
      collection: () => join(tmpdir(), 'surco-missing', 'master.db'),
      queue: q,
      flow: () => MY_FLOW,
    })
    expect(q.enqueue).not.toHaveBeenCalled()
  })
})
