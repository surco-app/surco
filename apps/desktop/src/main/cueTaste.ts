import log from 'electron-log/main'
import type { CueFlow } from '../shared/cueFlows'
import type { DropTaste, TasteCheck, TasteTrack, TunedTaste } from '../shared/dropTaste'
import { diagnoseLearnFlow, learnFlow } from '../shared/learnFlow'
import type { CollectionMarks } from './rekordboxLearnFlow'
import type { QueueStore } from './rekordboxQueue'

export const RELEARN_EVERY = 10
const MAX_EDITS = 1000

export interface CueProfile {
  learnedAt: string
  sources: { rekordbox: number; edits: number }
  taste: DropTaste | null
  check: TasteCheck | null
  flow: CueFlow | null
  coverage: { matching: number; marked: number } | null
  paired: number | null
  start: { open: number; withStart: number } | null
}

export interface CueTasteDeps {
  readCollection: () => Promise<CollectionMarks | null>
  tune: (tracks: TasteTrack[]) => Promise<TunedTaste | null>
  now?: () => Date
  onLearned?: (profile: CueProfile) => void
}

export interface CueTaste {
  profile: () => CueProfile | null
  edits: () => { count: number; sinceLearn: number }
  record: (track: TasteTrack, learnNow: boolean) => void
  learn: () => Promise<CueProfile>
}

interface Saved {
  profile: CueProfile | null
  edits: TasteTrack[]
  sinceLearn: number
}

function parse(text: string | null): Saved {
  const empty: Saved = { profile: null, edits: [], sinceLearn: 0 }
  if (!text) return empty
  try {
    const saved = JSON.parse(text) as Saved
    return { ...empty, ...saved }
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
  let learning: Promise<CueProfile> | null = null
  const save = () => store.write(JSON.stringify({ version: 1, ...saved }))
  const now = deps.now ?? (() => new Date())

  const run = async (): Promise<CueProfile> => {
    saved = { ...saved, sinceLearn: 0 }
    const collection = (await deps.readCollection()) ?? { learn: [], taste: [] }
    const byKey = new Map(collection.taste.map((t) => [t.key, t]))
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

  return {
    profile: () => saved.profile,
    edits: () => ({ count: saved.edits.length, sinceLearn: saved.sinceLearn }),
    record(track, learnNow) {
      const edits = [...saved.edits.filter((e) => e.key !== track.key), track].slice(-MAX_EDITS)
      saved = { ...saved, edits, sinceLearn: saved.sinceLearn + 1 }
      save()
      if (learnNow && saved.sinceLearn >= RELEARN_EVERY && !learning)
        learn().catch((err) => log.warn(`cue taste: learning from edits failed: ${String(err)}`))
    },
    learn,
  }
}
