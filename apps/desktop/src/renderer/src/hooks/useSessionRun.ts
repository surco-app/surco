import { useRef, useState } from 'react'
import type { SessionPlan } from '../../../shared/sessionBuild'
import type { LearnedMixing } from '../../../shared/sessionLearn'
import { uniqueName } from '../../../shared/sessionName'
import type { PlaylistRole, SessionAnswers, SessionTrack } from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, SourceNode } from '../../../shared/types'
import { runSession, type SessionRun } from '../lib/sessionRun'
import type { SessionPhase } from '../lib/sessionTree'
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
  startPath?: string
  learned: LearnedMixing
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
  phases?: () => Readonly<Record<string, SessionPhase>>
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
    startPath?: string,
  ): Promise<SessionRun> => {
    const library = deps.library?.() ?? {}
    const phases = deps.phases?.() ?? {}
    const loaded = await deps.rows.load(answers.sources)
    return runSession({
      answers,
      roles,
      rows: loaded,
      seed,
      library,
      startPath,
      made: deps.made?.(),
      phases,
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
    startPath?: string,
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
      startPath,
      learned: run.learned,
    })
    return 'built'
  }

  const build = useStableCallback(
    (parentId: string, answers: SessionAnswers, roles: Roles, startPath?: string) =>
      exclusive(async () => {
        deps.saveAnswers(answers)
        const seed = deps.newSeed()
        const run = await produce(answers, roles, seed, startPath)
        if (run.refs.length === 0) return 'empty'
        if (!(await deps.canWrite())) return 'closed'
        const name = deps.nameFor()
        const shown = uniqueName(name, deps.namesIn(parentId))
        const id = await deps.writer.create(parentId, shown, run.refs)
        if (id === null) return 'refused'
        const chosen = run.plan.items[0]?.why.kind === 'chosen' ? startPath : undefined
        return settle(id, parentId, name, shown, answers, roles, seed, run, chosen)
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
    keepStart: boolean,
  ): Promise<BuildResult> =>
    exclusive(async () => {
      const seed = previous.seed + 1
      deps.rows.reset()
      const startPath = keepStart ? previous.startPath : undefined
      const run = await produce(answers, roles, seed, startPath)
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
            run.plan.items[0]?.why.kind === 'chosen' ? startPath : undefined,
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

  const keep = useStableCallback(() => setRecent(null))

  const noteEdit = useStableCallback((playlistId: string) =>
    setRecent((current) => (current?.playlistId === playlistId ? null : current)),
  )

  return { recent, busy, build, fill, redo, adjust, keep, noteEdit }
}
