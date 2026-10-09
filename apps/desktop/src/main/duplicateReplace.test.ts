import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent, LibraryReplaceOutcome } from '../shared/types'
import { createActivity } from './activity'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import {
  libraryOutcomes,
  outcomeOf,
  type ReplaceDuplicatesDeps,
  type ReplacePair,
  replaceDuplicates,
  traktorDuplicateStep,
} from './duplicateReplace'

const PAIR: ReplacePair = { from: '/m/old.aiff', to: '/m/keep.aiff', shared: false }
const SHARED: ReplacePair = { from: '/m/same.aiff', to: '/m/same2.aiff', shared: true }

const step = (outcome: LibraryReplaceOutcome) =>
  vi.fn(async (pairs: unknown[]) => pairs.map(() => outcome))

function deps(over: Partial<ReplaceDuplicatesDeps> = {}): ReplaceDuplicatesDeps {
  return {
    libraries: { rekordbox: step('repointed') },
    usedByLibrary: vi.fn().mockResolvedValue(false),
    trash: vi.fn().mockResolvedValue('trash'),
    serial: (task) => task(),
    warn: vi.fn(),
    ...over,
  }
}

describe('replaceDuplicates', () => {
  it('moves every enabled library to the kept copy before trashing the removed file', async () => {
    const calls: string[] = []
    const d = deps({
      libraries: {
        rekordbox: vi.fn(async () => {
          calls.push('rekordbox')
          return ['repointed' as const]
        }),
        traktor: vi.fn(async () => {
          calls.push('traktor')
          return ['replaced' as const]
        }),
        engine: vi.fn(async () => {
          calls.push('engine')
          return ['none' as const]
        }),
      },
      usedByLibrary: vi.fn(async () => {
        calls.push('used')
        return false
      }),
      trash: vi.fn(async () => {
        calls.push('trash')
        return 'trash' as const
      }),
    })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      {
        from: PAIR.from,
        rekordbox: 'repointed',
        traktor: 'replaced',
        engine: 'none',
        fileTrashed: true,
        keptForLibrary: false,
      },
    ])
    expect(calls).toEqual(['traktor', 'rekordbox', 'engine', 'used', 'trash'])
    expect(d.libraries.rekordbox).toHaveBeenCalledWith([{ from: PAIR.from, to: PAIR.to }])
  })

  // Measured: some Music duplicates are two entries on one file. Trashing it would take the
  // kept copy's audio, and there is nothing for a library to move.
  it('never touches the libraries or the file for a shared file', async () => {
    const d = deps()
    expect(await replaceDuplicates([SHARED], d)).toEqual([
      { from: SHARED.from, fileTrashed: false, keptForLibrary: false },
    ])
    expect(d.libraries.rekordbox).not.toHaveBeenCalled()
    expect(d.trash).not.toHaveBeenCalled()
  })

  // rekordbox and Engine keep the removed copy's track, out of every playlist, so its file
  // is still theirs.
  it.each(['rekordbox', 'engine'] as const)(
    'keeps the file when %s still holds the removed copy',
    async (library) => {
      const d = deps({ libraries: { [library]: step('replaced') } })
      const [r] = await replaceDuplicates([PAIR], d)
      expect(r).toMatchObject({ [library]: 'replaced', fileTrashed: false, keptForLibrary: true })
      expect(d.trash).not.toHaveBeenCalled()
    },
  )

  // A library left on the removed file would show a missing track if the file went.
  it.each(['skipped', 'failed'] as const)('keeps the file when a library step is %s', async (o) => {
    const d = deps({ libraries: { rekordbox: step('replaced'), engine: step(o) } })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      {
        from: PAIR.from,
        rekordbox: 'replaced',
        engine: o,
        fileTrashed: false,
        keptForLibrary: true,
      },
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('records a library step that throws as failed and still runs the others', async () => {
    const d = deps({
      libraries: {
        traktor: vi.fn().mockRejectedValue(new Error('boom')),
        rekordbox: step('replaced'),
      },
    })
    const [r] = await replaceDuplicates([PAIR], d)
    expect(r).toMatchObject({ traktor: 'failed', rekordbox: 'replaced', fileTrashed: false })
    expect(d.warn).toHaveBeenCalled()
  })

  it('keeps the file a library still uses afterwards', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockResolvedValue(true) })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      { from: PAIR.from, rekordbox: 'repointed', fileTrashed: false, keptForLibrary: true },
    ])
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('keeps the file when a library cannot be read to check', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockRejectedValue(new Error('locked')) })
    const [r] = await replaceDuplicates([PAIR], d)
    expect(r).toMatchObject({ fileTrashed: false, keptForLibrary: true })
    expect(d.trash).not.toHaveBeenCalled()
  })

  it('reports a trash that fails without throwing', async () => {
    const d = deps({ trash: vi.fn().mockRejectedValue(new Error('gone')) })
    const [r] = await replaceDuplicates([PAIR], d)
    expect(r).toMatchObject({ fileTrashed: false, keptForLibrary: false })
  })

  it('trashes the file when no library sync is on', async () => {
    const d = deps({ libraries: {} })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      { from: PAIR.from, fileTrashed: true, keptForLibrary: false },
    ])
  })

  // Conversions and review syncs write the same databases; one at a time.
  it('runs the whole replacement inside the shared library queue', async () => {
    const order: string[] = []
    const d = deps({
      serial: async (task) => {
        order.push('queued')
        const r = await task()
        order.push('released')
        return r
      },
      trash: vi.fn(async () => {
        order.push('trash')
        return 'trash' as const
      }),
    })
    await replaceDuplicates([PAIR], d)
    expect(order).toEqual(['queued', 'trash', 'released'])
  })

  // List review order: the DJ libraries first, then Music lets go, and only then the Trash.
  it('lets Apple Music go between the libraries and the Trash', async () => {
    const calls: string[] = []
    const d = deps({
      libraries: {
        rekordbox: vi.fn(async () => {
          calls.push('rekordbox')
          return ['repointed' as const]
        }),
      },
      usedByLibrary: vi.fn(async () => {
        calls.push('used')
        return false
      }),
      musicStep: vi.fn(async () => {
        calls.push('music')
        return { step: 'removed' as const, playlists: 2 }
      }),
      trash: vi.fn(async () => {
        calls.push('trash')
        return 'trash' as const
      }),
    })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      {
        from: PAIR.from,
        rekordbox: 'repointed',
        music: 'removed',
        musicPlaylists: 2,
        fileTrashed: true,
        keptForLibrary: false,
      },
    ])
    expect(calls).toEqual(['rekordbox', 'used', 'music', 'trash'])
  })

  // A file Music still points at becomes a dead "!" entry with its playlists stranded.
  it.each(['kept-no-entry', 'ambiguous', 'mismatch', 'failed'] as const)(
    'keeps the file when Music answers %s',
    async (step) => {
      const d = deps({ musicStep: vi.fn().mockResolvedValue({ step }) })
      expect(await replaceDuplicates([PAIR], d)).toEqual([
        {
          from: PAIR.from,
          rekordbox: 'repointed',
          music: step,
          fileTrashed: false,
          keptForLibrary: false,
          keptForMusic: true,
        },
      ])
      expect(d.trash).not.toHaveBeenCalled()
    },
  )

  it('trashes a file Music never held', async () => {
    const d = deps({ musicStep: vi.fn().mockResolvedValue({ step: 'none' }) })
    expect((await replaceDuplicates([PAIR], d))[0]).toMatchObject({
      music: 'none',
      fileTrashed: true,
    })
  })

  it('keeps the file when the Music step throws', async () => {
    const d = deps({ musicStep: vi.fn().mockRejectedValue(new Error('osascript')) })
    expect((await replaceDuplicates([PAIR], d))[0]).toMatchObject({
      music: 'failed',
      keptForMusic: true,
      fileTrashed: false,
    })
    expect(d.trash).not.toHaveBeenCalled()
  })

  // Music only lets go of a copy whose file is really leaving.
  it('never asks Music when a library keeps the file', async () => {
    const d = deps({ usedByLibrary: vi.fn().mockResolvedValue(true), musicStep: vi.fn() })
    await replaceDuplicates([PAIR], d)
    expect(d.musicStep).not.toHaveBeenCalled()
  })

  it('never asks Music about two paths that may be one file', async () => {
    const d = deps({ musicStep: vi.fn() })
    await replaceDuplicates([SHARED], d)
    expect(d.musicStep).not.toHaveBeenCalled()
  })

  // Music already let go, so the file now sits outside every library: the user has to hear it.
  it('says so when the Trash fails after Music let go', async () => {
    const d = deps({
      musicStep: vi.fn().mockResolvedValue({ step: 'removed', playlists: 0 }),
      trash: vi.fn().mockRejectedValue(new Error('No recoverable trash')),
    })
    expect((await replaceDuplicates([PAIR], d))[0]).toMatchObject({
      music: 'removed',
      fileTrashed: false,
      trashFailed: true,
    })
  })
})

describe('outcomeOf', () => {
  it('names what a library writer did', () => {
    expect(outcomeOf({ written: true, outcome: 'replaced' })).toBe('replaced')
    expect(outcomeOf({ written: false, reason: 'no-match' })).toBe('none')
    for (const reason of [
      'rekordbox-running',
      'engine-running',
      'backup-failed',
      'unreadable',
      'read-only',
    ])
      expect(outcomeOf({ written: false, reason })).toBe('skipped')
    for (const reason of ['write-failed', 'ambiguous', 'output-missing', 'occupied'])
      expect(outcomeOf({ written: false, reason })).toBe('failed')
  })
})

describe('libraryOutcomes', () => {
  it('reads the outcomes from the writer the flush ran', async () => {
    const write = vi.fn(async () => [
      { written: true as const, outcome: 'repointed' as const },
      { written: false as const, reason: 'no-match' },
    ])
    const outcomes = await libraryOutcomes(
      [PAIR, PAIR],
      async (run) => {
        await run('/db', [PAIR, PAIR])
      },
      write,
    )
    expect(outcomes).toEqual(['repointed', 'none'])
  })

  it('reports skipped when the flush never ran the writer', async () => {
    expect(await libraryOutcomes([PAIR], async () => {}, vi.fn())).toEqual(['skipped'])
  })
})

describe('traktorDuplicateStep', () => {
  it('asks to close Traktor first and skips with a dialog when the user declines', async () => {
    const showBlockedDialog = vi.fn()
    const replace = vi.fn()
    expect(
      await traktorDuplicateStep([PAIR], {
        nmlPath: '/c.nml',
        ensureTraktorClosed: async () => false,
        showBlockedDialog,
        track: vi.fn((_kind, _key, run) => run()),
        replace,
      }),
    ).toEqual(['skipped'])
    expect(showBlockedDialog).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('leaves a warning row in Activity when the user keeps Traktor open', async () => {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    await traktorDuplicateStep([PAIR], {
      nmlPath: '/c.nml',
      ensureTraktorClosed: async () => false,
      showBlockedDialog: vi.fn(),
      track: activity.track,
      replace: vi.fn(),
    })
    expect(events.at(-1)).toMatchObject({
      phase: 'warn',
      labelKey: 'activity.traktorSync',
      detailKey: 'activity.traktorSyncTraktorRunning',
    })
  })

  it('writes the collection as an Activity step with Traktor locations', async () => {
    const replace = vi.fn().mockResolvedValue({ written: true, outcomes: ['replaced'] })
    const deps: Parameters<typeof traktorDuplicateStep>[1] = {
      nmlPath: '/c.nml',
      ensureTraktorClosed: async () => true,
      showBlockedDialog: vi.fn(),
      track: vi.fn((_kind, _key, run) => run()),
      replace,
    }
    expect(
      await traktorDuplicateStep([{ ...PAIR, from: '/Volumes/Public/a/old.aiff' }], deps),
    ).toEqual(['replaced'])
    expect(deps.track).toHaveBeenCalledWith(
      'export',
      'activity.traktorSync',
      expect.any(Function),
      expect.anything(),
    )
    expect(replace).toHaveBeenCalledWith('/c.nml', [
      {
        from: { volume: 'Public', dir: '/:a/:', file: 'old.aiff' },
        to: { volume: '', dir: '/:m/:', file: 'keep.aiff' },
      },
    ])
  })
})

// The second half of a removed copy's Activity row: what became of its file, under the
// row the removal opened.
describe('replaceDuplicates in Activity', () => {
  function logged(over: Partial<ReplaceDuplicatesDeps> = {}) {
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))
    const copies = new Map([
      [PAIR.from, { group: 'duplicate-OLD', label: 'Old copy' }],
      [SHARED.from, { group: 'duplicate-SAME', label: 'Same copy' }],
    ])
    const d = deps({
      log: { track: activity.track, copyOf: (path) => copies.get(path) },
      ...over,
    })
    return { events, d }
  }
  const end = (events: ActivityEvent[]) => events.find((e) => e.phase !== 'start')

  it('says the file went to the Trash, under the copy it belonged to', async () => {
    const { events, d } = logged({ trash: vi.fn().mockResolvedValue('trash') })
    await replaceDuplicates([PAIR], d)
    expect(events[0]).toMatchObject({
      phase: 'start',
      labelKey: 'activity.reviewDuplicateFile',
      group: 'duplicate-OLD',
      groupLabel: 'Old copy',
    })
    expect(end(events)).toMatchObject({
      phase: 'done',
      detailKey: 'activity.reviewDuplicateFileTrash',
    })
  })

  it('says the file went to Surco’s backup on a disk with no Trash', async () => {
    const { events, d } = logged({ trash: vi.fn().mockResolvedValue('surco') })
    await replaceDuplicates([PAIR], d)
    expect(end(events)).toMatchObject({ detailKey: 'activity.reviewDuplicateFileSurco' })
  })

  it.each([
    ['shared with the kept copy', [SHARED], {}, 'done', 'activity.reviewDuplicateFileShared'],
    [
      'held by a library that was not updated',
      [PAIR],
      { libraries: { rekordbox: step('skipped') } },
      'warn',
      'activity.reviewDuplicateFileUnsettled',
    ],
    [
      'used by a library',
      [PAIR],
      { usedByLibrary: vi.fn().mockResolvedValue(true) },
      'done',
      'activity.reviewDuplicateFileUsed',
    ],
    [
      'not trashable',
      [PAIR],
      { trash: vi.fn().mockRejectedValue(new Error('gone')) },
      'error',
      'activity.reviewDuplicateFileTrashFailed',
    ],
  ] as const)(
    'says why the file stayed when it is %s',
    async (_name, pairs, over, phase, detailKey) => {
      const { events, d } = logged(over)
      await replaceDuplicates([...pairs], d)
      expect(end(events)).toMatchObject({ phase, detailKey })
    },
  )

  it('logs nothing for a file no removed copy owns', async () => {
    const { events, d } = logged()
    await replaceDuplicates([{ ...PAIR, from: '/m/unknown.aiff' }], d)
    expect(events).toEqual([])
  })
})
