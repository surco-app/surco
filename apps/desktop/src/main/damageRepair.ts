import type { DamageOutcome, DamageRepair, DamageRepairItem, TrashEntry } from '../shared/types'
import { type EngineRepoint, engineLengthOf } from './engineRepoint'
import { ENGINE_KEYS, flushEngineSync } from './engineSyncFlush'
import type { FlushLibraryDeps, LibraryRepointResult } from './libraryRepointFlush'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { entryStates, type NmlPatch } from './traktorNml'
import { type FlushTraktorSyncDeps, flushTraktorSync } from './traktorSyncFlush'

export const pendingDamage = new Set<string>()

export interface DamageRepairDeps {
  beginMoment: () => void
  genre: ListApplyDeps
  rewriteTree?: (
    file: string,
    addMs: number,
    expected: number[],
  ) => Promise<{ written: boolean; backup?: TrashEntry }>
  traktor?: Omit<FlushTraktorSyncDeps, 'endNmlBatch' | 'queue'> & {
    bootVolume: string
    readCollection: () => Promise<string | null>
    hold?: (patches: NmlPatch[], states: string[], nmlPath: string) => Promise<void>
    waiting?: () => boolean
  }
  engine?: Omit<FlushLibraryDeps<EngineRepoint>, 'endBatch'> & {
    countSamples: (path: string) => Promise<number | null>
    enqueue?: (repoints: EngineRepoint[]) => void
  }
}

type Of<T extends DamageRepair['target']> = {
  id: string
  repair: Extract<DamageRepair, { target: T }>
}

async function repairGenres(items: Of<'genre'>[], deps: ListApplyDeps): Promise<DamageOutcome[]> {
  const outcomes = await applyListFixes(
    {
      fixes: items.map(({ repair }) => ({
        id: repair.path,
        field: 'genre',
        from: repair.from,
        to: repair.to,
      })),
      music: {},
    },
    deps,
  )
  return items.map(({ id, repair }): DamageOutcome => {
    const o = outcomes.find((x) => x.id === repair.path)
    if (!o || o.file === 'failed') return { id, state: 'failed', error: o?.error ?? 'failed' }
    if (!o.written.includes('genre')) return { id, state: 'unchanged' }
    return { id, state: 'repaired', ...(o.backupId ? { backupId: o.backupId } : {}) }
  })
}

async function repairEntries(
  items: Of<'traktor'>[],
  deps: NonNullable<DamageRepairDeps['traktor']>,
): Promise<DamageOutcome[]> {
  const located = items.flatMap(({ id, repair }) =>
    repair.entry
      ? [
          {
            id,
            state: repair.entry.entryState,
            patch: {
              volume: repair.entry.volume,
              dir: repair.entry.dir,
              file: repair.entry.file,
              cueShift: { shiftMs: -repair.addMs },
            } as NmlPatch,
          },
        ]
      : [],
  )
  const nml = await deps.readCollection()
  const now =
    nml === null
      ? []
      : entryStates(
          nml,
          located.map((l) => l.patch),
          deps.bootVolume,
        )
  const kept = located.filter((l, i) => nml === null || now[i] === l.state)
  let held = false
  const { hold } = deps
  const result =
    kept.length === 0
      ? { outcome: 'nothing' as const }
      : await flushTraktorSync({
          ...deps,
          endNmlBatch: () => kept.map((l) => l.patch),
          ...(hold && {
            queue: {
              waiting: deps.waiting ?? (() => false),
              hold: (patches: NmlPatch[], path: string) => {
                held = true
                return hold(
                  patches,
                  kept.map((l) => l.state),
                  path,
                )
              },
            },
          }),
        })
  const state: DamageOutcome['state'] =
    held || result.outcome === 'open'
      ? 'pending'
      : result.outcome === 'updated'
        ? 'repaired'
        : result.outcome === 'nothing'
          ? 'unchanged'
          : 'failed'
  return located.map(({ id }) =>
    kept.some((l) => l.id === id) ? { id, state } : { id, state: 'unchanged' },
  )
}

const RANK: DamageOutcome['state'][] = ['failed', 'pending', 'repaired', 'unchanged']

async function repairTraktor(
  items: Of<'traktor'>[],
  deps: DamageRepairDeps,
): Promise<DamageOutcome[]> {
  const trees = new Map<string, DamageOutcome>()
  for (const { id, repair } of items) {
    if (!repair.treeFile) continue
    if (!deps.rewriteTree) {
      trees.set(id, { id, state: 'failed', error: 'libraryOff' })
      continue
    }
    try {
      const r = await deps.rewriteTree(repair.treeFile, repair.addMs, repair.treeMs ?? [])
      trees.set(
        id,
        r.written
          ? { id, state: 'repaired', ...(r.backup ? { backupId: r.backup.id } : {}) }
          : { id, state: 'unchanged' },
      )
    } catch (e) {
      trees.set(id, { id, state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }
  const withEntry = items.filter((i) => i.repair.entry)
  const entries =
    withEntry.length === 0
      ? []
      : deps.traktor
        ? await repairEntries(withEntry, deps.traktor)
        : withEntry.map(({ id }): DamageOutcome => ({ id, state: 'failed', error: 'libraryOff' }))
  return items.map(({ id }) => {
    const parts = [trees.get(id), entries.find((o) => o.id === id)].filter(
      (o): o is DamageOutcome => o !== undefined,
    )
    const [first] = [...parts].sort((a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state))
    const backupId = trees.get(id)?.backupId
    return {
      ...(first ?? { id, state: 'unchanged' }),
      ...(backupId ? { backupId } : {}),
    }
  })
}

async function repairEngine(
  items: Of<'engine'>[],
  deps: NonNullable<DamageRepairDeps['engine']>,
): Promise<DamageOutcome[]> {
  const repoints: EngineRepoint[] = []
  const counted: Of<'engine'>[] = []
  const outcomes: DamageOutcome[] = []
  for (const item of items) {
    const { repair } = item
    const base = {
      from: repair.path,
      to: repair.path,
      fromBytes: repair.fileBytes,
      expectTrackData: repair.expectTrackData,
    }
    if (repair.trimmedMs === 0 && !repair.sampleRateHz) {
      const { sampleCount, sampleRate } = repair.expectTrackData
      repoints.push({ ...base, length: engineLengthOf(sampleCount, sampleRate) })
      counted.push(item)
      continue
    }
    const sampleCount = await deps.countSamples(repair.path).catch(() => null)
    if (sampleCount === null) {
      outcomes.push({ id: item.id, state: 'failed', error: 'unreadable' })
      continue
    }
    const rate = repair.sampleRateHz ?? repair.expectTrackData.sampleRate
    repoints.push({
      ...base,
      engineShift: {
        trimmedMs: repair.trimmedMs,
        ...(repair.sampleRateHz ? { sampleRateHz: repair.sampleRateHz } : {}),
        sampleCount,
      },
      length: engineLengthOf(sampleCount, rate),
    })
    counted.push(item)
  }
  if (repoints.length === 0) return outcomes
  let results: LibraryRepointResult[] | null = null
  const flushed = await flushEngineSync({
    ...(deps as Omit<FlushLibraryDeps, 'endBatch' | 'repointTracks'>),
    endBatch: () => repoints as never,
    repointTracks: async (dir, list) => {
      results = await deps.repointTracks(dir, list as unknown as EngineRepoint[])
      return results
    },
  })
  if (flushed.blocked === ENGINE_KEYS.runningReason && deps.enqueue) {
    deps.enqueue(repoints)
    return [...outcomes, ...counted.map(({ id }): DamageOutcome => ({ id, state: 'pending' }))]
  }
  const done = results as LibraryRepointResult[] | null
  return [
    ...outcomes,
    ...counted.map(({ id }, i): DamageOutcome => {
      const r = done?.[i]
      if (!r) return { id, state: 'failed', error: flushed.blocked ?? 'unreadable' }
      if (r.written) return { id, state: 'repaired' }
      return r.reason === 'no-match'
        ? { id, state: 'unchanged' }
        : { id, state: 'failed', error: r.reason }
    }),
  ]
}

export async function repairDamage(
  items: DamageRepairItem[],
  deps: DamageRepairDeps,
): Promise<DamageOutcome[]> {
  if (items.length === 0) return []
  deps.beginMoment()
  const of = <T extends DamageRepair['target']>(target: T) =>
    items.filter((i): i is Of<T> => i.repair.target === target)
  const unsupported = (list: DamageRepairItem[]) =>
    list.map(({ id }): DamageOutcome => ({ id, state: 'failed', error: 'libraryOff' }))
  const genres = of('genre')
  const traktor = of('traktor')
  const engine = of('engine')
  const outcomes = [
    ...(genres.length > 0 ? await repairGenres(genres, deps.genre) : []),
    ...(traktor.length === 0 ? [] : await repairTraktor(traktor, deps)),
    ...(engine.length === 0
      ? []
      : deps.engine
        ? await repairEngine(engine, deps.engine)
        : unsupported(engine)),
  ]
  for (const o of outcomes) if (o.state === 'pending') pendingDamage.add(o.id)
  return items.map(({ id }) => outcomes.find((o) => o.id === id) ?? { id, state: 'unchanged' })
}
