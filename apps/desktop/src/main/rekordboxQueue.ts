import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import log from 'electron-log/main'
import type {
  RekordboxEditRefusal,
  RekordboxQueueItem,
  RekordboxQueueNotice,
  RekordboxQueueState,
  RekordboxQueueWritten,
} from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { BatchResult, CuesOp, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'

// What waits for one collection. Each collection keeps its own, so pointing Surco at
// another one never throws away what waits for the first, and a queue is only ever applied
// to the collection it was made for.
interface CollectionQueue<R extends QueuedRepoint = RekordboxRepoint> {
  repoints: R[]
  ops: QueueOp[]
  halted?: true
  collection?: string
}

// Version 1 held a single collection's queue at the top level: it is read as that
// collection's queue.
interface QueueFile<R extends QueuedRepoint = RekordboxRepoint> {
  version: 2
  queues: CollectionQueue<R>[]
}

export interface QueueStore {
  read: () => string | null
  write: (text: string) => void
  setAside: () => void
}

export function fileStore(path: string): QueueStore {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: (text) => {
      writeFileSync(`${path}.tmp`, text, 'utf8')
      renameSync(`${path}.tmp`, path)
    },
    setAside: () => renameSync(path, `${path}.unreadable`),
  }
}

// What the queue keeps of a conversion it could not write yet: the file the library names
// now and the one it should name. rekordbox keeps its repoints, Traktor its collection
// patches (traktorPatchQueue.ts).
export interface QueuedRepoint {
  from: string
  to: string
}

export interface QueueDeps<R extends QueuedRepoint = RekordboxRepoint> {
  store: QueueStore
  collection: () => string
  // The collection the settings name, read when it is not there now: what waits for an
  // unplugged drive belongs to the collection on it, and to no other mounted meanwhile.
  configured?: () => string
  applyBatch: (
    collectionPath: string,
    ops: QueueOp[],
    ensureClosed: () => Promise<boolean>,
    stillQueued: (id: string) => boolean,
  ) => Promise<BatchResult>
  repoint: (collectionPath: string, repoints: R[]) => Promise<LibraryRepointResult[]>
  nodeStamps: (collectionPath: string) => Promise<Record<string, number>>
  onChange: (state: RekordboxQueueState) => void
  addsTracks?: boolean
}

export type QueueApply =
  | { status: 'empty' }
  | { status: 'refused'; reason: RekordboxEditRefusal }
  | {
      status: 'applied'
      tracks: number
      changes: number
      notices: RekordboxQueueNotice[]
      written: RekordboxQueueWritten[]
      outcomes: OpOutcome[]
    }

export interface RekordboxQueue<R extends QueuedRepoint = RekordboxRepoint> {
  enqueue: (ops: QueueOp[], repoints?: R[]) => void
  state: () => RekordboxQueueState
  // Tells the window the state again: the collection in use changed, not the queue.
  announce: () => void
  isEmpty: () => boolean
  discard: () => void
  discardCurrent: () => void
  drop: (id: string) => void
  cuesOp: (contentId: string) => CuesOp | undefined
  // A repoint by this source waits for the collection in use.
  holdsRepoint: (from: string) => boolean
  busy: () => boolean
  settled: () => Promise<void>
  apply: (ensureClosed: () => Promise<boolean>, opts?: { manual?: boolean }) => Promise<QueueApply>
}

export const COLLECTION_WIDE: ReadonlySet<string> = new Set([
  'rekordbox-running',
  'backup-failed',
  'read-only',
  'unreadable',
  'write-failed',
])

export function keyOf(op: QueueOp): string {
  if (op.kind === 'track') return `track:${op.path}`
  if (op.kind === 'cues') return `cues:${op.contentId}`
  return `edit:${op.id}`
}

const isQueue = (q: CollectionQueue<QueuedRepoint> | undefined): boolean =>
  Array.isArray(q?.ops) && Array.isArray(q?.repoints)

const isEmptyQueue = (q: CollectionQueue<QueuedRepoint>): boolean =>
  q.repoints.length === 0 && q.ops.length === 0

function load<R extends QueuedRepoint>(store: QueueStore): QueueFile<R> {
  const empty: QueueFile<R> = { version: 2, queues: [] }
  const text = store.read()
  if (text === null) return empty
  let parsed: (CollectionQueue<R> & { version: 1 }) | QueueFile<R> | null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  if (parsed?.version === 1 && isQueue(parsed)) {
    const { version: _, ...queue } = parsed
    return { version: 2, queues: [queue] }
  }
  if (parsed?.version === 2 && Array.isArray(parsed.queues) && parsed.queues.every(isQueue))
    return parsed
  log.warn('rekordbox queue file unreadable, set aside as .unreadable')
  store.setAside()
  return empty
}

function stateOf(
  q: CollectionQueue<QueuedRepoint> | undefined,
  elsewhere: number,
  addsTracks: boolean,
): RekordboxQueueState {
  const items = new Map<string, RekordboxQueueItem>()
  const item = (key: string, label: string): RekordboxQueueItem => {
    const found = items.get(key)
    if (found) return found
    const made: RekordboxQueueItem = { key, label, parts: [] }
    items.set(key, made)
    return made
  }
  for (const r of q?.repoints ?? [])
    item(`track:${r.to}`, basename(r.to)).parts.push({ kind: 'repoint' })
  for (const op of q?.ops ?? []) {
    if (op.kind === 'edit') {
      item(keyOf(op), op.label ?? '').parts.push({ kind: 'tree', edit: op.edit.kind })
      continue
    }
    const it = item(`track:${op.path}`, op.label)
    if (op.kind === 'cues') {
      it.parts.push({ kind: 'cues' })
      continue
    }
    it.label = op.label
    if (op.add || (!op.contentId && addsTracks)) it.parts.push({ kind: 'collection' })
    if (!op.add || op.wanted.length > 0)
      it.parts.push({ kind: 'playlists', names: op.wanted.map((t) => t.name) })
  }
  const all = [...items.values()]
  const tracks = all.filter((i) => i.key.startsWith('track:')).length
  return {
    tracks,
    changes: all.length - tracks,
    items: all,
    ...(q?.halted ? { halted: true } : {}),
    ...(elsewhere > 0 ? { elsewhere } : {}),
  }
}

type Applied = Extract<QueueApply, { status: 'applied' }>

export function withoutOp(result: Applied, id: string): Applied {
  const own = result.outcomes.find((o) => o.id === id)
  if (!own) return result
  return {
    ...result,
    changes: result.changes - (own.applied ? 1 : 0),
    notices: result.notices.filter((n) => !own.notices.includes(n)),
    outcomes: result.outcomes.filter((o) => o !== own),
  }
}

export function createRekordboxQueue<R extends QueuedRepoint = RekordboxRepoint>(
  deps: QueueDeps<R>,
): RekordboxQueue<R> {
  const file = load<R>(deps.store)
  let chain: Promise<unknown> = Promise.resolve()
  let pending = 0

  // The collection in use, or the one the settings name while its drive is unplugged. A
  // queue made while no collection was known belongs to whichever is found.
  const here = (): string => deps.collection() || deps.configured?.() || ''
  const queueFor = (collection: string): CollectionQueue<R> | undefined =>
    file.queues.find((q) => (q.collection ?? '') === collection) ??
    file.queues.find((q) => !q.collection)
  // With no collection at all there is no other one either: what waits is shown as is.
  const shown = (): CollectionQueue<R> | undefined =>
    queueFor(here()) ?? (here() ? undefined : file.queues[0])

  const state = (): RekordboxQueueState => {
    const own = shown()
    const elsewhere = file.queues
      .filter((q) => q !== own)
      .reduce((sum, q) => {
        const s = stateOf(q, 0, deps.addsTracks ?? true)
        return sum + s.tracks + s.changes
      }, 0)
    const waiting = stateOf(own, elsewhere, deps.addsTracks ?? true)
    const unplugged =
      !deps.collection() && !!deps.configured?.() && waiting.tracks + waiting.changes > 0
    return unplugged ? { ...waiting, unplugged: true } : waiting
  }

  const save = (): void => {
    file.queues = file.queues.filter((q) => !isEmptyQueue(q) || q.halted)
    deps.store.write(JSON.stringify(file))
    deps.onChange(state())
  }

  const clear = (gone: CollectionQueue<R>[]): void => {
    for (const q of gone) {
      q.repoints = []
      q.ops = []
      delete q.halted
    }
    save()
  }

  const refused = (reason: RekordboxEditRefusal): QueueApply => ({ status: 'refused', reason })

  const logResult = (result: QueueApply): void => {
    const at = deps.collection() || 'no collection'
    if (result.status === 'refused') {
      if (stillWaiting(result)) log.info(`library queue for ${at} waits: ${result.reason}`)
      else log.warn(`library queue for ${at} refused: ${result.reason}`)
    }
    if (result.status === 'applied' && result.notices.length > 0)
      log.warn(`library queue for ${at} notices: ${JSON.stringify(result.notices)}`)
  }

  const run = async (
    ensureClosed: () => Promise<boolean>,
    manual: boolean,
  ): Promise<QueueApply> => {
    if (file.queues.every(isEmptyQueue)) return { status: 'empty' }
    const collectionPath = deps.collection()
    if (!collectionPath) return refused('unreadable')
    const q = queueFor(collectionPath)
    if (!q || isEmptyQueue(q)) return { status: 'empty' }
    if (q.halted && !manual) return refused('write-unknown')
    const repoints = [...q.repoints]
    let askBatch = ensureClosed
    const repointedTo = new Set<string>()
    const repointNotices: RekordboxQueueNotice[] = []
    if (repoints.length > 0) {
      if (!(await ensureClosed())) return refused('cancelled')
      askBatch = async () => true
      const results = await deps.repoint(collectionPath, repoints)
      const wide = results.find((r) => !r.written && COLLECTION_WIDE.has(r.reason))
      if (wide && !wide.written) return refused(wide.reason as RekordboxEditRefusal)
      for (const [i, r] of results.entries()) {
        if (r.written) repointedTo.add(repoints[i].to)
        else if (r.reason === 'ambiguous')
          repointNotices.push({ code: 'ambiguous', track: basename(repoints[i].to) })
        else if (r.reason === 'output-missing')
          repointNotices.push({ code: 'file-missing', track: basename(repoints[i].to) })
        else if (r.reason === 'no-match')
          log.info(`rekordbox repoint found no match for ${basename(repoints[i].to)}`)
      }
      q.repoints = q.repoints.filter((r) => !repoints.includes(r))
      save()
    }
    const ops = [...q.ops]
    if (ops.length === 0)
      return {
        status: 'applied',
        tracks: repointedTo.size,
        changes: 0,
        notices: repointNotices,
        written: [],
        outcomes: [],
      }
    let before: Record<string, number> | null = null
    const askAndSnapshot = async (): Promise<boolean> => {
      if (!(await askBatch())) return false
      try {
        before = await deps.nodeStamps(collectionPath)
      } catch (err) {
        log.warn(`rekordbox node stamps unreadable before the batch: ${String(err)}`)
      }
      return true
    }
    const queued = (id: string): boolean => q.ops.some((o) => o.id === id)
    const result = await deps.applyBatch(collectionPath, ops, askAndSnapshot, queued)
    if (!result.ok) {
      if (result.reason === 'write-unknown') {
        q.halted = true
        save()
      }
      return refused(result.reason)
    }
    const kept = result.outcomes.filter((o) => queued(o.id))
    const given = new Set(ops.map((o) => o.id))
    q.ops = q.ops.filter((o) => !given.has(o.id))
    delete q.halted
    save()
    if (result.wrote && before) {
      try {
        const after = await deps.nodeStamps(collectionPath)
        for (const op of q.ops) {
          if (op.kind === 'cues') continue
          for (const [id, stamp] of Object.entries(op.stamps))
            if (stamp === before[id] && after[id] !== undefined) op.stamps[id] = after[id]
        }
        save()
      } catch (err) {
        log.warn(`rekordbox node stamps unreadable after the batch: ${String(err)}`)
      }
    }
    const byId = new Map(ops.map((o) => [o.id, o]))
    const outcomes = kept.map((o): OpOutcome => {
      const op = byId.get(o.id)
      if (
        op?.kind === 'edit' &&
        !o.applied &&
        o.notices.length === 0 &&
        o.reason !== 'nothing-to-add'
      )
        return { ...o, notices: [{ code: 'edit-changed', playlist: op.label ?? '' }] }
      return o
    })
    const notices = [...repointNotices, ...outcomes.flatMap((o) => o.notices)]
    const appliedOps = outcomes.filter((o) => o.applied).map((o) => byId.get(o.id))
    const tracks = new Set([
      ...repointedTo,
      ...appliedOps.flatMap((op) => (op && op.kind !== 'edit' ? [op.path] : [])),
    ]).size
    const changes = appliedOps.filter((op) => op?.kind === 'edit').length
    const written = appliedOps.flatMap((op) =>
      op?.kind === 'track' ? [{ path: op.path, wanted: op.wanted }] : [],
    )
    return { status: 'applied', tracks, changes, notices, written, outcomes }
  }

  return {
    announce() {
      deps.onChange(state())
    },
    enqueue(ops, repoints = []) {
      const at = here()
      let q = queueFor(at)
      if (!q) {
        q = { repoints: [], ops: [] }
        file.queues.push(q)
      }
      if (isEmptyQueue(q)) q.collection = at || undefined
      for (const r of repoints) {
        const at = q.repoints.findIndex((x) => x.from === r.from)
        if (at === -1) q.repoints.push(r)
        else q.repoints[at] = r
      }
      for (const op of ops) {
        const at = q.ops.findIndex((x) => keyOf(x) === keyOf(op))
        if (at === -1) q.ops.push(op)
        else q.ops[at] = op
      }
      save()
    },
    state,
    isEmpty: () => file.queues.every(isEmptyQueue),
    discard() {
      const own = shown()
      clear(own && (!isEmptyQueue(own) || own.halted) ? [own] : file.queues)
    },
    discardCurrent() {
      const own = shown()
      clear(own ? [own] : [])
    },
    drop(id) {
      const q = shown()
      if (q) q.ops = q.ops.filter((o) => o.id !== id)
      save()
    },
    cuesOp: (contentId) =>
      shown()?.ops.find((o): o is CuesOp => o.kind === 'cues' && o.contentId === contentId),
    holdsRepoint: (from) => queueFor(here())?.repoints.some((r) => r.from === from) ?? false,
    busy: () => pending > 0,
    settled: () => chain.then(() => undefined),
    apply(ensureClosed, opts) {
      pending += 1
      const next = chain
        .then(() => run(ensureClosed, opts?.manual ?? false))
        .then((result) => {
          logResult(result)
          return result
        })
        .finally(() => {
          pending -= 1
        })
      chain = next.catch(() => undefined)
      return next
    },
  }
}
