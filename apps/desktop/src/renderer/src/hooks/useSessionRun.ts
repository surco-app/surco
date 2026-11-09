import { useRef, useState } from 'react'
import type { SessionPlan } from '../../../shared/sessionBuild'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { runSession, type SessionRun } from '../lib/sessionRun'
import type { SessionRows } from './useSessionRows'
import type { SessionWriter } from './useSessionWrite'
import { useStableCallback } from './useStableCallback'

export type BuildResult = 'built' | 'empty' | 'refused'

export interface RecentSession {
  playlistId: string
  parentId: string
  name: string
  answers: SessionAnswers
  seed: number
  plan: SessionPlan
}

export interface SessionRunDeps {
  roles: Readonly<Record<string, PlaylistRole>>
  rows: SessionRows
  writer: SessionWriter
  nameFor: () => string
  openPlaylist: (node: SourceNode) => void
  saveAnswers: (answers: SessionAnswers) => void
  newSeed: () => number
}

export interface SessionRunner {
  recent: RecentSession | null
  busy: boolean
  build: (parentId: string, answers: SessionAnswers) => Promise<BuildResult>
  redo: () => Promise<BuildResult>
  adjust: (answers: SessionAnswers) => Promise<BuildResult>
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
      return await job()
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  const produce = async (answers: SessionAnswers, seed: number): Promise<SessionRun> => {
    const loaded = await deps.rows.load([...answers.sources, ...answers.fresh])
    return runSession({ answers, roles: deps.roles, rows: loaded, seed })
  }

  const settle = (
    id: string,
    parentId: string,
    name: string,
    answers: SessionAnswers,
    seed: number,
    run: SessionRun,
  ): BuildResult => {
    deps.openPlaylist({ id, name, kind: 'playlist', count: run.refs.length })
    setRecent({ playlistId: id, parentId, name, answers, seed, plan: run.plan })
    return 'built'
  }

  const build = useStableCallback((parentId: string, answers: SessionAnswers) =>
    exclusive(async () => {
      deps.saveAnswers(answers)
      const seed = deps.newSeed()
      const run = await produce(answers, seed)
      if (run.refs.length === 0) return 'empty'
      const name = deps.nameFor()
      const id = await deps.writer.create(parentId, name, run.refs)
      return id === null ? 'refused' : settle(id, parentId, name, answers, seed, run)
    }),
  )

  const replaceWith = (previous: RecentSession, answers: SessionAnswers): Promise<BuildResult> =>
    exclusive(async () => {
      const seed = previous.seed + 1
      const run = await produce(answers, seed)
      if (run.refs.length === 0) return 'empty'
      const id = await deps.writer.replace(
        previous.parentId,
        previous.playlistId,
        previous.name,
        run.refs,
      )
      return id === null
        ? 'refused'
        : settle(id, previous.parentId, previous.name, answers, seed, run)
    })

  const redo = useStableCallback(async () =>
    recent ? replaceWith(recent, recent.answers) : 'refused',
  )

  const adjust = useStableCallback(async (answers: SessionAnswers) => {
    if (!recent) return 'refused'
    deps.saveAnswers(answers)
    return replaceWith(recent, answers)
  })

  const keep = useStableCallback(() => setRecent(null))

  const noteEdit = useStableCallback((playlistId: string) =>
    setRecent((current) => (current?.playlistId === playlistId ? null : current)),
  )

  return { recent, busy, build, redo, adjust, keep, noteEdit }
}
