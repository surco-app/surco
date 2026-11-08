import { randomUUID } from 'node:crypto'
import log from 'electron-log/main'
import type { CueProfile } from '../shared/cueProfile'
import { fingerprintOf, type TasteTrack, type TunedTaste } from '../shared/dropTaste'
import { diagnoseLearnFlow, learnFlow } from '../shared/learnFlow'
import type { CollectionMarks } from './rekordboxLearnFlow'
import type { QueueStore } from './rekordboxQueue'

export const RELEARN_EVERY = 10
export const RELEARN_AFTER_CORRECTIONS = 3
export const SHARE_AFTER_MS = 60_000
const MAX_EDITS = 1000

export interface SharedEdits {
  write: (machine: string, edits: TasteTrack[]) => void
  readOthers: (machine: string) => TasteTrack[]
}

export interface CueTasteDeps {
  readCollection: () => Promise<CollectionMarks | null>
  tune: (tracks: TasteTrack[]) => Promise<TunedTaste | null>
  shared?: SharedEdits
  newId?: () => string
  now?: () => Date
  onLearned?: (profile: CueProfile) => void
}

export interface CueTaste {
  profile: () => CueProfile | null
  edits: () => { count: number; sinceLearn: number }
  record: (track: TasteTrack, learnNow: boolean) => void
  learn: () => Promise<CueProfile>
  refresh: (learnNow: boolean) => void
  flush: () => void
}

interface Saved {
  profile: CueProfile | null
  edits: TasteTrack[]
  sinceLearn: number
  corrections?: number
  othersSeen?: number
  machine?: string
}

function parse(text: string | null): Saved {
  const empty: Saved = { profile: null, edits: [], sinceLearn: 0 }
  if (!text) return empty
  try {
    const saved = { ...empty, ...(JSON.parse(text) as Saved) }
    return {
      ...saved,
      edits: saved.edits.map((e) => ({ ...e, key: fingerprintOf(e.candidates) })),
    }
  } catch (err) {
    log.warn(`cue taste unreadable, starting empty: ${String(err)}`)
    return empty
  }
}

function flowFacts(collection: CollectionMarks) {
  const learned = learnFlow(collection.learn)
  if (!learned) return { flow: null, coverage: null, paired: null, start: null }
  const d = diagnoseLearnFlow(collection.learn)
  return {
    flow: learned.flow,
    coverage: learned.coverage,
    paired: d.countdownPaired,
    start: d.start,
  }
}

export function createCueTaste(
  store: Pick<QueueStore, 'read' | 'write'>,
  deps: CueTasteDeps,
): CueTaste {
  let saved = parse(store.read())
  const machine = saved.machine ?? (deps.newId ?? randomUUID)()
  saved = { ...saved, machine }
  let learning: Promise<CueProfile> | null = null
  const save = () => store.write(JSON.stringify({ version: 1, ...saved }))
  const now = deps.now ?? (() => new Date())

  const othersEdits = (): TasteTrack[] => {
    try {
      return deps.shared?.readOthers(machine) ?? []
    } catch (err) {
      log.warn(`cue taste: other Macs' edits unreadable, learning without them: ${String(err)}`)
      return []
    }
  }

  let shareTimer: ReturnType<typeof setTimeout> | null = null

  const shareEdits = (): void => {
    try {
      deps.shared?.write(machine, saved.edits)
    } catch (err) {
      log.warn(`cue taste: edits not shared with other Macs: ${String(err)}`)
    }
  }

  const shareSoon = (): void => {
    if (shareTimer) clearTimeout(shareTimer)
    shareTimer = setTimeout(() => {
      shareTimer = null
      shareEdits()
    }, SHARE_AFTER_MS)
    shareTimer.unref?.()
  }

  const flush = (): void => {
    if (!shareTimer) return
    clearTimeout(shareTimer)
    shareTimer = null
    shareEdits()
  }

  const run = async (): Promise<CueProfile> => {
    saved = { ...saved, sinceLearn: 0, corrections: 0 }
    const collection = (await deps.readCollection()) ?? { learn: [], taste: [] }
    const byKey = new Map(collection.taste.map((t) => [t.key, t]))
    const others = othersEdits()
    saved = { ...saved, othersSeen: others.length }
    for (const edit of others) byKey.set(edit.key, edit)
    for (const edit of saved.edits) byKey.set(edit.key, edit)
    const tuned = await deps.tune([...byKey.values()])
    const profile: CueProfile = {
      learnedAt: now().toISOString(),
      sources: { rekordbox: collection.learn.length, edits: saved.edits.length },
      taste: tuned?.taste ?? null,
      check: tuned?.check ?? null,
      ...flowFacts(collection),
    }
    saved = { ...saved, profile }
    save()
    deps.onLearned?.(profile)
    return profile
  }

  const learn = (): Promise<CueProfile> => {
    learning ??= run().finally(() => {
      learning = null
    })
    return learning
  }

  const learnInBackground = (): void => {
    learn().catch((err) => log.warn(`cue taste: learning from edits failed: ${String(err)}`))
  }

  return {
    profile: () => saved.profile,
    edits: () => ({ count: saved.edits.length, sinceLearn: saved.sinceLearn }),
    record(track, learnNow) {
      const edits = [...saved.edits.filter((e) => e.key !== track.key), track].slice(-MAX_EDITS)
      const corrected = track.outcome === 'corrected' || track.outcome === 'manual'
      saved = {
        ...saved,
        edits,
        sinceLearn: saved.sinceLearn + 1,
        corrections: (saved.corrections ?? 0) + (corrected ? 1 : 0),
      }
      save()
      shareSoon()
      const due =
        saved.sinceLearn >= RELEARN_EVERY || (saved.corrections ?? 0) >= RELEARN_AFTER_CORRECTIONS
      if (learnNow && due && !learning) learnInBackground()
    },
    refresh(learnNow) {
      if (!learnNow || learning) return
      const count = othersEdits().length
      if (count > 0 && count !== (saved.othersSeen ?? 0)) learnInBackground()
    },
    learn,
    flush,
  }
}
