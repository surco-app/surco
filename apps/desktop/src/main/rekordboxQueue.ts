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
import type { BatchResult, OpOutcome, QueueOp } from './rekordboxQueueOps'

interface QueueFile {
  version: 1
  repoints: RekordboxRepoint[]
  ops: QueueOp[]
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

export interface QueueDeps {
  store: QueueStore
  collection: () => string
  applyBatch: (
    collectionPath: string,
    ops: QueueOp[],
    ensureClosed: () => Promise<boolean>,
  ) => Promise<BatchResult>
  repoint: (collectionPath: string, repoints: RekordboxRepoint[]) => Promise<LibraryRepointResult[]>
  nodeStamps: (collectionPath: string) => Promise<Record<string, number>>
  onChange: (state: RekordboxQueueState) => void
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

export interface RekordboxQueue {
  enqueue: (ops: QueueOp[], repoints?: RekordboxRepoint[]) => void
  state: () => RekordboxQueueState
  isEmpty: () => boolean
  discard: () => void
  drop: (id: string) => void
  busy: () => boolean
  settled: () => Promise<void>
  apply: (ensureClosed: () => Promise<boolean>) => Promise<QueueApply>
}

const COLLECTION_WIDE: ReadonlySet<string> = new Set([
  'rekordbox-running',
  'backup-failed',
  'read-only',
  'unreadable',
  'write-failed',
])

export function keyOf(op: QueueOp): string {
  return op.kind === 'track' ? `track:${op.path}` : `edit:${op.id}`
}

function load(store: QueueStore): QueueFile {
  const empty: QueueFile = { version: 1, repoints: [], ops: [] }
  const text = store.read()
  if (text === null) return empty
  let parsed: QueueFile | null
  try {
    parsed = JSON.parse(text) as QueueFile
  } catch {
    parsed = null
  }
  if (parsed?.version === 1 && Array.isArray(parsed.ops) && Array.isArray(parsed.repoints))
    return parsed
  log.warn('rekordbox queue file unreadable, set aside as .unreadable')
  store.setAside()
  return empty
}

function stateOf(q: QueueFile): RekordboxQueueState {
  const items = new Map<string, RekordboxQueueItem>()
  const item = (key: string, label: string): RekordboxQueueItem => {
    const found = items.get(key)
    if (found) return found
    const made: RekordboxQueueItem = { key, label, parts: [] }
    items.set(key, made)
    return made
  }
  for (const r of q.repoints) item(`track:${r.to}`, basename(r.to)).parts.push({ kind: 'repoint' })
  for (const op of q.ops) {
    const it = item(keyOf(op), op.kind === 'track' ? op.label : (op.label ?? ''))
    if (op.kind === 'track') {
      it.label = op.label
      if (!op.contentId) it.parts.push({ kind: 'collection' })
      it.parts.push({ kind: 'playlists', names: op.wanted.map((t) => t.name) })
    } else it.parts.push({ kind: 'tree', edit: op.edit.kind })
  }
  const all = [...items.values()]
  const tracks = all.filter((i) => i.key.startsWith('track:')).length
  return { tracks, changes: all.length - tracks, items: all }
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

export function createRekordboxQueue(deps: QueueDeps): RekordboxQueue {
  const q = load(deps.store)
  let chain: Promise<unknown> = Promise.resolve()
  let pending = 0

  const save = (): void => {
    deps.store.write(JSON.stringify(q))
    deps.onChange(stateOf(q))
  }

  const refused = (reason: RekordboxEditRefusal): QueueApply => ({ status: 'refused', reason })

  const run = async (ensureClosed: () => Promise<boolean>): Promise<QueueApply> => {
    if (q.repoints.length === 0 && q.ops.length === 0) return { status: 'empty' }
    const collectionPath = deps.collection()
    if (!collectionPath) return refused('unreadable')
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
    const result = await deps.applyBatch(collectionPath, ops, askAndSnapshot)
    if (!result.ok) return refused(result.reason)
    const given = new Set(ops.map((o) => o.id))
    q.ops = q.ops.filter((o) => !given.has(o.id))
    save()
    if (result.wrote && before) {
      try {
        const after = await deps.nodeStamps(collectionPath)
        for (const op of q.ops)
          for (const [id, stamp] of Object.entries(op.stamps))
            if (stamp === before[id] && after[id] !== undefined) op.stamps[id] = after[id]
        save()
      } catch (err) {
        log.warn(`rekordbox node stamps unreadable after the batch: ${String(err)}`)
      }
    }
    const byId = new Map(ops.map((o) => [o.id, o]))
    const outcomes = result.outcomes.map((o): OpOutcome => {
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
      ...appliedOps.flatMap((op) => (op?.kind === 'track' ? [op.path] : [])),
    ]).size
    const changes = appliedOps.filter((op) => op?.kind === 'edit').length
    const written = appliedOps.flatMap((op) =>
      op?.kind === 'track' ? [{ path: op.path, wanted: op.wanted }] : [],
    )
    return { status: 'applied', tracks, changes, notices, written, outcomes }
  }

  return {
    enqueue(ops, repoints = []) {
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
    state: () => stateOf(q),
    isEmpty: () => q.repoints.length === 0 && q.ops.length === 0,
    discard() {
      q.repoints = []
      q.ops = []
      save()
    },
    drop(id) {
      q.ops = q.ops.filter((o) => o.id !== id)
      save()
    },
    busy: () => pending > 0,
    settled: () => chain.then(() => undefined),
    apply(ensureClosed) {
      pending += 1
      const next = chain
        .then(() => run(ensureClosed))
        .finally(() => {
          pending -= 1
        })
      chain = next.catch(() => undefined)
      return next
    },
  }
}
