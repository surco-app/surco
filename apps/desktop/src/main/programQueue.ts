import type { DjProgram } from '../shared/djProgram'
import type { CopyReason } from '../shared/types'
import type { RekordboxRepoint } from './rekordboxBatch'
import {
  createRekordboxQueue,
  type QueueApply,
  type QueueDeps,
  type QueuedRepoint,
  type RekordboxQueue,
} from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting, watchRekordboxQueue } from './rekordboxQueueWatch'

type Serial = <T>(task: () => Promise<T>) => Promise<T>

export interface ProgramQueueSpec<R extends QueuedRepoint = RekordboxRepoint> {
  program: DjProgram
  queue: QueueDeps<R>
  appliedChannel: string
  alwaysWatch?: () => boolean
  onClosed?: () => void
}

export interface ProgramQueueDeps {
  broadcast: (channel: string, payload: unknown) => void
  settled: (program: DjProgram, result: QueueApply | 'threw') => void
  moments: { begin: (reason: CopyReason, programs?: readonly DjProgram[]) => void }
  serial: Serial
  processes: Record<DjProgram, { isRunning: () => Promise<boolean> }>
}

export interface ProgramQueue<R extends QueuedRepoint = RekordboxRepoint> {
  queue: RekordboxQueue<R>
  watch: { poke: () => void; stop: () => void }
  applyQuietly: (serial?: Serial) => void
  announceApplied: (result: QueueApply) => void
}

export function createProgramQueue<R extends QueuedRepoint = RekordboxRepoint>(
  spec: ProgramQueueSpec<R>,
  deps: ProgramQueueDeps,
): ProgramQueue<R> {
  const { program } = spec
  const collection = spec.queue.collection
  const queue = createRekordboxQueue<R>(spec.queue)
  const announceApplied = (result: QueueApply): void => {
    const notice = appliedNotice(result)
    if (notice) deps.broadcast(spec.appliedChannel, notice)
    deps.settled(program, result)
  }
  const watch = watchRekordboxQueue({
    queue: {
      isEmpty: () => queue.isEmpty(),
      apply: (ensureClosed) =>
        deps.serial(() => {
          deps.moments.begin('queue', [program])
          return queue.apply(ensureClosed)
        }),
    },
    collection,
    isRunning: deps.processes[program].isRunning,
    onApplied: announceApplied,
    alwaysWatch: spec.alwaysWatch,
    onClosed: spec.onClosed,
  })
  const applyQuietly = (serial = deps.serial): void => {
    if (!collection()) {
      watch.poke()
      return
    }
    void serial(() => queue.apply(async () => !(await deps.processes[program].isRunning()))).then(
      (result) => {
        announceApplied(result)
        if (stillWaiting(result)) watch.poke()
      },
      () => deps.settled(program, 'threw'),
    )
  }
  return { queue, watch, applyQuietly, announceApplied }
}
