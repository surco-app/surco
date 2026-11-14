import { useRef, useState } from 'react'
import type { SessionPlan } from '../../../shared/sessionBuild'
import type { LearnedMixing } from '../../../shared/sessionLearn'
import { uniqueName } from '../../../shared/sessionName'
import type { PlaylistRole, SessionAnswers, SessionTrack } from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, QueuedCreate, SourceNode } from '../../../shared/types'
import { runSession, type SessionRun } from '../lib/sessionRun'
import type { SessionPhase } from '../lib/sessionTree'
import type { SessionRows } from './useSessionRows'
import type { SessionWriter, SessionWritten } from './useSessionWrite'
import { useStableCallback } from './useStableCallback'

export type BuildResult = 'built' | 'queued' | 'empty' | 'refused'

export interface RecentSession {
  playlistId: string
  waiting?: string
  parentId: string
  name: string
  shown: string
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
  matching?: () => Promise<readonly (readonly [string, string])[]>
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
  noteCreated: (created: readonly QueuedCreate[]) => void
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
    const matching = (await deps.matching?.()) ?? []
    return runSession({
      answers,
      roles,
      rows: loaded,
      seed,
      library,
      startPath,
      made: deps.made?.(),
      phases,
      matching,
    })
  }

  const settle = (
    written: SessionWritten,
    parentId: string,
    name: string,
    shown: string,
    answers: SessionAnswers,
    roles: Roles,
    seed: number,
    run: SessionRun,
    startPath?: string,
    outcome: BuildResult = 'built',
  ): BuildResult => {
    const session = {
      parentId,
      name,
      shown,
      answers,
      roles,
      seed,
      plan: run.plan,
      pool: run.pool,
      refsById: run.refsById,
      startPath,
      learned: run.learned,
    }
    if ('queued' in written) {
      setRecent({ ...session, playlistId: '', waiting: written.queued })
      return 'queued'
    }
    deps.noteMade?.(written.id)
    deps.openPlaylist({ id: written.id, name: shown, kind: 'playlist', count: run.refs.length })
    setRecent({ ...session, playlistId: written.id })
    return outcome
  }

  const build = useStableCallback(
    (parentId: string, answers: SessionAnswers, roles: Roles, startPath?: string) =>
      exclusive(async () => {
        deps.saveAnswers(answers)
        const seed = deps.newSeed()
        const run = await produce(answers, roles, seed, startPath)
        if (run.refs.length === 0) return 'empty'
        const name = deps.nameFor()
        const shown = uniqueName(name, deps.namesIn(parentId))
        const written = await deps.writer.create(parentId, shown, run.refs)
        if (written === null) return 'refused'
        const chosen = run.plan.items[0]?.why.kind === 'chosen' ? startPath : undefined
        return settle(written, parentId, name, shown, answers, roles, seed, run, chosen)
      }),
  )

  const fill = useStableCallback((target: FillTarget, answers: SessionAnswers, roles: Roles) =>
    exclusive(async () => {
      deps.saveAnswers(answers)
      const seed = deps.newSeed()
      const run = await produce(answers, roles, seed)
      if (run.refs.length === 0) return 'empty'
      const filled = await deps.writer.fill(target.id, target.name, run.refs)
      if (filled === 'refused') return 'refused'
      return settle(
        { id: target.id },
        target.parentId,
        target.name,
        target.name,
        answers,
        roles,
        seed,
        run,
        undefined,
        filled === 'queued' ? 'queued' : 'built',
      )
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
      const shown = uniqueName(previous.name, deps.namesIn(previous.parentId))
      const written = await deps.writer.replace(
        previous.parentId,
        previous.playlistId,
        shown,
        run.refs,
      )
      return written === null
        ? 'refused'
        : settle(
            written,
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
    recent && !recent.waiting ? replaceWith(recent, recent.answers, recent.roles, true) : 'refused',
  )

  const adjust = useStableCallback(async (answers: SessionAnswers, roles: Roles) => {
    if (!recent || recent.waiting) return 'refused'
    deps.saveAnswers(answers)
    return replaceWith(recent, answers, roles, false)
  })

  const keep = useStableCallback(() => setRecent(null))

  const noteEdit = useStableCallback((playlistId: string) =>
    setRecent((current) => (current?.playlistId === playlistId ? null : current)),
  )

  const noteCreated = useStableCallback((created: readonly QueuedCreate[]) => {
    const made = recent?.waiting && created.find((c) => c.opId === recent.waiting)
    if (!recent || !made) return
    deps.noteMade?.(made.createdId)
    deps.openPlaylist({
      id: made.createdId,
      name: recent.shown,
      kind: 'playlist',
      count: recent.refsById.size,
    })
    setRecent({ ...recent, playlistId: made.createdId, waiting: undefined })
  })

  return { recent, busy, build, fill, redo, adjust, keep, noteEdit, noteCreated }
}
