import { useRef, useState } from 'react'
import { type SessionPlan, swapAt } from '../../../shared/sessionBuild'
import { uniqueName } from '../../../shared/sessionName'
import type { PlaylistRole, SessionAnswers, SessionTrack } from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, SourceNode } from '../../../shared/types'
import { alternativesFor } from '../lib/sessionAlternatives'
import { runSession, type SessionPins, type SessionRun, sessionOptionsOf } from '../lib/sessionRun'
import type { SessionRows } from './useSessionRows'
import type { SessionWriter } from './useSessionWrite'
import { useStableCallback } from './useStableCallback'

export type BuildResult = 'built' | 'empty' | 'refused' | 'closed'

export interface RecentSession {
  playlistId: string
  parentId: string
  name: string
  answers: SessionAnswers
  roles: Readonly<Record<string, PlaylistRole>>
  seed: number
  plan: SessionPlan
  pool: SessionTrack[]
  refsById: ReadonlyMap<string, PlaylistTrackRef>
  locked: ReadonlySet<string>
}

type Roles = Readonly<Record<string, PlaylistRole>>

export interface SessionRunDeps {
  canWrite: () => Promise<boolean>
  rows: SessionRows
  writer: SessionWriter
  namesIn: (parentId: string) => ReadonlySet<string>
  nameFor: () => string
  openPlaylist: (node: SourceNode) => void
  saveAnswers: (answers: SessionAnswers) => void
  newSeed: () => number
  library?: () => Readonly<Record<string, 'base' | 'vocal'>>
  made?: () => ReadonlySet<string>
  noteMade?: (playlistId: string) => void
}

export interface FillTarget {
  id: string
  name: string
  parentId: string
}

export interface SessionRunner {
  recent: RecentSession | null
  busy: boolean
  build: (
    parentId: string,
    answers: SessionAnswers,
    roles: Roles,
    startPath?: string,
  ) => Promise<BuildResult>
  fill: (target: FillTarget, answers: SessionAnswers, roles: Roles) => Promise<BuildResult>
  redo: () => Promise<BuildResult>
  adjust: (answers: SessionAnswers, roles: Roles) => Promise<BuildResult>
  swap: (index: number, track: SessionTrack) => Promise<BuildResult>
  alternatives: (index: number) => SessionTrack[]
  toggleLock: (trackId: string) => void
  keep: () => void
  noteEdit: (playlistId: string) => void
}

export function useSessionRun(deps: SessionRunDeps): SessionRunner {
  const [recent, setRecent] = useState<RecentSession | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)

  const exclusive = async (job: () => Promise<BuildResult>): Promise<BuildResult> => {
    if (working.current) return 'refused'
    working.current = true
    setBusy(true)
    try {
      if (!(await deps.canWrite())) return 'closed'
      return await job()
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  const produce = async (
    answers: SessionAnswers,
    roles: Roles,
    seed: number,
    pins?: SessionPins,
    startPath?: string,
  ): Promise<SessionRun> => {
    const library = deps.library?.() ?? {}
    const chosen = new Set(answers.sources)
    const given = Object.keys(library).filter((id) => !chosen.has(id))
    const loaded = await deps.rows.load([...answers.sources, ...given])
    return runSession({
      answers,
      roles,
      rows: loaded,
      seed,
      library,
      pins,
      startPath,
      made: deps.made?.(),
    })
  }

  const settle = (
    id: string,
    parentId: string,
    name: string,
    shown: string,
    answers: SessionAnswers,
    roles: Roles,
    seed: number,
    run: SessionRun,
    locked: ReadonlySet<string> = new Set(),
  ): BuildResult => {
    deps.noteMade?.(id)
    deps.openPlaylist({ id, name: shown, kind: 'playlist', count: run.refs.length })
    setRecent({
      playlistId: id,
      parentId,
      name,
      answers,
      roles,
      seed,
      plan: run.plan,
      pool: run.pool,
      refsById: run.refsById,
      locked,
    })
    return 'built'
  }

  const build = useStableCallback(
    (parentId: string, answers: SessionAnswers, roles: Roles, startPath?: string) =>
      exclusive(async () => {
        deps.saveAnswers(answers)
        const seed = deps.newSeed()
        const run = await produce(answers, roles, seed, undefined, startPath)
        if (run.refs.length === 0) return 'empty'
        if (!(await deps.canWrite())) return 'closed'
        const name = deps.nameFor()
        const shown = uniqueName(name, deps.namesIn(parentId))
        const id = await deps.writer.create(parentId, shown, run.refs)
        if (id === null) return 'refused'
        const opening = run.plan.items[0]
        const locked = new Set(opening?.why.kind === 'chosen' ? [opening.track.id] : [])
        return settle(id, parentId, name, shown, answers, roles, seed, run, locked)
      }),
  )

  const fill = useStableCallback((target: FillTarget, answers: SessionAnswers, roles: Roles) =>
    exclusive(async () => {
      deps.saveAnswers(answers)
      const seed = deps.newSeed()
      const run = await produce(answers, roles, seed)
      if (run.refs.length === 0) return 'empty'
      if (!(await deps.canWrite())) return 'closed'
      const written = await deps.writer.fill(target.id, target.name, run.refs)
      return written
        ? settle(target.id, target.parentId, target.name, target.name, answers, roles, seed, run)
        : 'refused'
    }),
  )

  const replaceWith = (
    previous: RecentSession,
    answers: SessionAnswers,
    roles: Roles,
    keepLocks: boolean,
  ): Promise<BuildResult> =>
    exclusive(async () => {
      const seed = previous.seed + 1
      deps.rows.reset()
      const pinned = keepLocks
        ? previous.plan.items.flatMap((item, index) =>
            previous.locked.has(item.track.id) ? [{ index, trackId: item.track.id }] : [],
          )
        : []
      const run = await produce(
        answers,
        roles,
        seed,
        pinned.length > 0 ? { pinned, length: previous.plan.items.length } : undefined,
      )
      if (run.refs.length === 0) return 'empty'
      if (!(await deps.canWrite())) return 'closed'
      const shown = uniqueName(previous.name, deps.namesIn(previous.parentId))
      const id = await deps.writer.replace(previous.parentId, previous.playlistId, shown, run.refs)
      return id === null
        ? 'refused'
        : settle(
            id,
            previous.parentId,
            previous.name,
            shown,
            answers,
            roles,
            seed,
            run,
            new Set(
              pinned
                .map((pin) => pin.trackId)
                .filter((trackId) => run.plan.items.some((item) => item.track.id === trackId)),
            ),
          )
    })

  const redo = useStableCallback(async () =>
    recent ? replaceWith(recent, recent.answers, recent.roles, true) : 'refused',
  )

  const adjust = useStableCallback(async (answers: SessionAnswers, roles: Roles) => {
    if (!recent) return 'refused'
    deps.saveAnswers(answers)
    return replaceWith(recent, answers, roles, false)
  })

  const alternatives = useStableCallback((index: number): SessionTrack[] =>
    recent
      ? alternativesFor(
          recent.plan,
          index,
          recent.pool,
          sessionOptionsOf(recent.answers, recent.seed),
        )
      : [],
  )

  const swap = useStableCallback(async (index: number, track: SessionTrack) => {
    if (!recent) return 'refused'
    const plan = swapAt(
      recent.plan,
      index,
      track,
      recent.answers.minutes * 60,
      recent.answers.playMinutes * 60,
    )
    if (plan === recent.plan) return 'refused'
    return exclusive(async () => {
      const refs = plan.items.map((item) => recent.refsById.get(item.track.id) ?? { paths: [] })
      const shown = uniqueName(recent.name, deps.namesIn(recent.parentId))
      const id = await deps.writer.replace(recent.parentId, recent.playlistId, shown, refs)
      if (id === null) return 'refused'
      deps.noteMade?.(id)
      deps.openPlaylist({ id, name: shown, kind: 'playlist', count: refs.length })
      const locked = new Set(recent.locked)
      locked.delete(recent.plan.items[index].track.id)
      locked.add(track.id)
      setRecent({ ...recent, playlistId: id, plan, locked })
      return 'built'
    })
  })

  const toggleLock = useStableCallback((trackId: string) =>
    setRecent((current) => {
      if (!current?.plan.items.some((item) => item.track.id === trackId)) return current
      const locked = new Set(current.locked)
      if (!locked.delete(trackId)) locked.add(trackId)
      return { ...current, locked }
    }),
  )

  const keep = useStableCallback(() => setRecent(null))

  const noteEdit = useStableCallback((playlistId: string) =>
    setRecent((current) => (current?.playlistId === playlistId ? null : current)),
  )

  return { recent, busy, build, fill, redo, adjust, swap, alternatives, toggleLock, keep, noteEdit }
}
