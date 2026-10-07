import { describe, expect, it, vi } from 'vitest'
import type { LibraryReplaceOutcome } from '../shared/types'

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
    libraries: { rekordbox: step('replaced') },
    usedByLibrary: vi.fn().mockResolvedValue(false),
    trash: vi.fn().mockResolvedValue(undefined),
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
          return ['replaced' as const]
        }),
        traktor: vi.fn(async () => {
          calls.push('traktor')
          return ['repointed' as const]
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
      }),
    })
    expect(await replaceDuplicates([PAIR], d)).toEqual([
      {
        from: PAIR.from,
        rekordbox: 'replaced',
        traktor: 'repointed',
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
      { from: PAIR.from, rekordbox: 'replaced', fileTrashed: false, keptForLibrary: true },
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
      }),
    })
    await replaceDuplicates([PAIR], d)
    expect(order).toEqual(['queued', 'trash', 'released'])
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
