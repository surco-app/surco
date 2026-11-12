import { app } from 'electron'
import type { CueSource } from '../../main/cueSource'
import { registerCuesIpc } from '../../main/cuesIpc'
import { registerDjIpc } from '../../main/djIpc'
import { engineCueQueueSection } from '../../main/engineCueQueueIpc'
import { engineCueSource } from '../../main/engineCueSource'
import { engineEdit } from '../../main/enginePlaylistEditIpc'
import { engineRead } from '../../main/enginePlaylistsIpc'
import { rekordboxCollectionPath } from '../../main/libraryFlushes'
import { serialLibraryFlush } from '../../main/libraryTagSync'
import { rekordboxCueSource } from '../../main/rekordboxCueSource'
import { rekordboxEdit, rekordboxRead } from '../../main/rekordboxPlaylistsIpc'
import type { RekordboxQueue } from '../../main/rekordboxQueue'
import { rekordboxQueueSection } from '../../main/rekordboxQueueIpc'
import { seratoCueSource } from '../../main/seratoCueSource'
import { seratoEdit } from '../../main/seratoPlaylistEditIpc'
import { seratoRead } from '../../main/seratoPlaylistsIpc'
import { getSettings } from '../../main/settings'
import { traktorCueQueueSection } from '../../main/traktorCueQueueIpc'
import { traktorCueSource } from '../../main/traktorCueSource'
import { bootVolumeName } from '../../main/traktorNmlLibrary'
import { traktorEdit } from '../../main/traktorPlaylistEditIpc'
import { traktorRead } from '../../main/traktorPlaylistsIpc'
import { virtualdjCueSource } from '../../main/virtualdjCueSource'
import { virtualdjEdit } from '../../main/virtualdjPlaylistEditIpc'
import { virtualdjRead } from '../../main/virtualdjPlaylistsIpc'
import { waitingCueQueueSection } from '../../main/waitingCueQueueIpc'
import { activeCueFlow } from '../../shared/cueFlows'
import type { DjMainTable } from '../../shared/djApi'
import type { DjProgram } from '../../shared/djProgram'
import { type Queues, seratoRoots, virtualdjRoots } from '../harness'

const closed = async () => true
const notRunning = async () => false
const none = async () => null

export function registerDoor(current: () => Queues): { settled: () => Promise<void> } {
  const lazy = <P extends keyof Queues>(program: P): Queues[P] =>
    new Proxy({} as Queues[P], {
      get: (_target, key) => (current()[program] as unknown as Record<PropertyKey, unknown>)[key],
    })
  const queues: Queues = {
    rekordbox: lazy('rekordbox'),
    engine: lazy('engine'),
    traktor: lazy('traktor'),
    serato: lazy('serato'),
    virtualdj: lazy('virtualdj'),
  }
  const inFlight = new Set<Promise<unknown>>()
  const applying = (queue: Pick<RekordboxQueue, 'apply'>) => () => {
    const work = serialLibraryFlush(() => queue.apply(closed))
    inFlight.add(work)
    work.then(
      () => inFlight.delete(work),
      () => inFlight.delete(work),
    )
  }
  const engineDir = () => getSettings().engineLibraryDir
  const traktorNml = () => getSettings().traktorNmlPath
  const section = { isClosed: closed, onWaiting: () => {}, onReady: () => {} }
  const table: DjMainTable = {
    rekordbox: {
      read: rekordboxRead(rekordboxCollectionPath, rekordboxCollectionPath, {}),
      edit: rekordboxEdit(rekordboxCollectionPath, {
        isRunning: notRunning,
        queue: queues.rekordbox,
      }),
      cueQueue: rekordboxQueueSection(queues.rekordbox, section),
    },
    engine: {
      read: engineRead(engineDir, { artDir: () => app.getPath('userData') }),
      edit: engineEdit({
        libraryDir: engineDir,
        queue: queues.engine,
        isRunning: notRunning,
      }),
      cueQueue: engineCueQueueSection(queues.engine, section),
    },
    traktor: {
      read: traktorRead(traktorNml, { bootVolume: bootVolumeName }),
      edit: traktorEdit({
        collection: traktorNml,
        queue: queues.traktor,
        isRunning: notRunning,
      }),
      cueQueue: traktorCueQueueSection(queues.traktor, section),
    },
    serato: {
      read: seratoRead({ roots: seratoRoots }),
      edit: seratoEdit({ roots: seratoRoots, queue: queues.serato, isRunning: notRunning }),
      running: notRunning,
      cueQueue: waitingCueQueueSection(queues.serato, {
        isRunning: notRunning,
        onWaiting: () => {},
        onReady: () => {},
      }),
    },
    virtualdj: {
      read: virtualdjRead({ roots: virtualdjRoots }),
      edit: virtualdjEdit({
        roots: virtualdjRoots,
        queue: queues.virtualdj,
        isRunning: notRunning,
      }),
      running: notRunning,
      cueQueue: waitingCueQueueSection(queues.virtualdj, {
        isRunning: notRunning,
        onWaiting: () => {},
        onReady: () => {},
      }),
    },
  }
  const sources: Record<DjProgram, CueSource> = {
    rekordbox: rekordboxCueSource({
      collection: rekordboxCollectionPath,
      queue: queues.rekordbox,
      applyQuietly: applying(queues.rekordbox),
      beatGrid: none,
      words: none,
    }),
    engine: engineCueSource(
      {
        libraryDir: engineDir,
        queue: queues.engine,
        applyQuietly: applying(queues.engine),
        words: none,
      },
      rekordboxCollectionPath,
      none,
    ),
    traktor: traktorCueSource(
      {
        nml: traktorNml,
        bootVolume: bootVolumeName,
        queue: queues.traktor,
        applyQuietly: applying(queues.traktor),
        words: none,
      },
      rekordboxCollectionPath,
      none,
    ),
    serato: seratoCueSource(
      { words: none, queue: queues.serato, applyQuietly: applying(queues.serato) },
      rekordboxCollectionPath,
    ),
    virtualdj: virtualdjCueSource(
      {
        roots: virtualdjRoots,
        words: none,
        beatGrid: none,
        queue: queues.virtualdj,
        applyQuietly: applying(queues.virtualdj),
      },
      rekordboxCollectionPath,
    ),
  }
  registerDjIpc(table)
  registerCuesIpc({
    collection: rekordboxCollectionPath,
    flow: () => activeCueFlow(getSettings()),
    provisional: { add: () => {} },
    twins: async () => ({}),
    sources,
  })
  return {
    settled: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
  }
}
