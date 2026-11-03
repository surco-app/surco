import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryRepointResult } from './libraryRepointFlush'
import { createProgramQueue, type ProgramQueueDeps, type ProgramQueueSpec } from './programQueue'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { QueueDeps } from './rekordboxQueue'

vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const REPOINT: RekordboxRepoint = { from: '/m/a.mp3', to: '/m/a.wav' }

function spySerial() {
  const calls = vi.fn()
  const serial: ProgramQueueDeps['serial'] = (task) => {
    calls()
    return task()
  }
  return { serial, calls }
}

function setup(over: Partial<ProgramQueueSpec<RekordboxRepoint>> = {}) {
  const running = { now: true }
  const collection = { path: '/engine/Database2' }
  const order: string[] = []
  const repoint = vi.fn<QueueDeps['repoint']>(async (_c, list) => {
    order.push('repoint')
    return list.map((): LibraryRepointResult => ({ written: true }))
  })
  const serial = spySerial()
  const deps = {
    broadcast: vi.fn<ProgramQueueDeps['broadcast']>(),
    settled: vi.fn<ProgramQueueDeps['settled']>(),
    moments: {
      begin: vi.fn<ProgramQueueDeps['moments']['begin']>(() => {
        order.push('begin')
      }),
    },
    serial: serial.serial,
    processes: {
      rekordbox: { isRunning: async () => false },
      traktor: { isRunning: async () => false },
      engine: { isRunning: vi.fn(async () => running.now) },
    } satisfies ProgramQueueDeps['processes'],
  }
  const spec: ProgramQueueSpec<RekordboxRepoint> = {
    program: 'engine',
    appliedChannel: 'engine:cueQueueApplied',
    queue: {
      store: { read: () => null, write: () => {}, setAside: () => {} },
      collection: () => collection.path,
      applyBatch: async () => ({ ok: true, wrote: true, outcomes: [] }),
      repoint,
      nodeStamps: async () => ({}),
      onChange: () => {},
    },
    ...over,
  }
  const pq = createProgramQueue(spec, deps)
  return { pq, deps, serialCalls: serial.calls, running, collection, repoint, order }
}

const appliedBroadcasts = (broadcast: ReturnType<typeof setup>['deps']['broadcast']) =>
  broadcast.mock.calls.filter(([channel]) => channel === 'engine:cueQueueApplied')

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createProgramQueue', () => {
  it('watches again when a quiet apply finds the program open, so what waits lands once it closes', async () => {
    const { pq, deps, running } = setup()
    pq.queue.enqueue([], [REPOINT])
    pq.applyQuietly()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.settled).toHaveBeenCalledWith('engine', { status: 'refused', reason: 'cancelled' })
    expect(appliedBroadcasts(deps.broadcast)).toEqual([])
    running.now = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(pq.queue.isEmpty()).toBe(true)
    expect(appliedBroadcasts(deps.broadcast)).toHaveLength(1)
    pq.watch.stop()
  })

  it('does not watch after a quiet apply that wrote, because polling costs a process listing every 5 s', async () => {
    const { pq, deps, running } = setup()
    running.now = false
    pq.queue.enqueue([], [REPOINT])
    pq.applyQuietly()
    await vi.advanceTimersByTimeAsync(0)
    expect(pq.queue.isEmpty()).toBe(true)
    const checks = deps.processes.engine.isRunning.mock.calls.length
    await vi.advanceTimersByTimeAsync(20000)
    expect(deps.processes.engine.isRunning.mock.calls.length).toBe(checks)
  })

  it('runs a quiet apply through the serial it is given, so a run flush can hold it behind its own writes', async () => {
    const { pq, serialCalls, running } = setup()
    running.now = false
    pq.queue.enqueue([], [REPOINT])
    const later = spySerial()
    pq.applyQuietly(later.serial)
    await vi.advanceTimersByTimeAsync(0)
    expect(later.calls).toHaveBeenCalledTimes(1)
    expect(serialCalls).not.toHaveBeenCalled()
  })

  it('only watches when the collection is not there, since there is nothing to write to yet', async () => {
    const { pq, deps, serialCalls, repoint, collection } = setup()
    collection.path = ''
    pq.queue.enqueue([], [REPOINT])
    pq.applyQuietly()
    await vi.advanceTimersByTimeAsync(0)
    expect(serialCalls).not.toHaveBeenCalled()
    expect(repoint).not.toHaveBeenCalled()
    expect(deps.processes.engine.isRunning).not.toHaveBeenCalled()
    collection.path = '/engine/Database2'
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.processes.engine.isRunning).toHaveBeenCalled()
    pq.watch.stop()
  })

  it('marks the apply as thrown when writing throws, so the held tracks read as failed and not pending', async () => {
    const { pq, deps, running, repoint } = setup()
    running.now = false
    repoint.mockRejectedValueOnce(new Error('disk gone'))
    pq.queue.enqueue([], [REPOINT])
    pq.applyQuietly()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.settled).toHaveBeenCalledWith('engine', 'threw')
    expect(deps.settled).toHaveBeenCalledTimes(1)
  })

  it("announces on the program's own channel and settles the program's checks with the result", () => {
    const { pq, deps } = setup()
    const result = { status: 'refused', reason: 'write-failed' } as const
    pq.announceApplied(result)
    expect(deps.broadcast).toHaveBeenCalledWith('engine:cueQueueApplied', {
      refused: 'write-failed',
    })
    expect(deps.settled).toHaveBeenCalledWith('engine', result)
  })

  it('announces nothing for a queue still waiting, yet settles it so the checks show it pending', () => {
    const { pq, deps } = setup()
    const result = { status: 'refused', reason: 'cancelled' } as const
    pq.announceApplied(result)
    expect(deps.broadcast).not.toHaveBeenCalled()
    expect(deps.settled).toHaveBeenCalledWith('engine', result)
  })

  it("opens the program's copy moment before the watch writes, so the backup is taken first", async () => {
    const { pq, deps, serialCalls, running, order } = setup()
    pq.queue.enqueue([], [REPOINT])
    pq.watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.moments.begin).not.toHaveBeenCalled()
    running.now = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.moments.begin).toHaveBeenCalledWith('queue', ['engine'])
    expect(order).toEqual(['begin', 'repoint'])
    expect(serialCalls).toHaveBeenCalledTimes(1)
    expect(appliedBroadcasts(deps.broadcast)).toHaveLength(1)
    pq.watch.stop()
  })

  it('keeps watching an empty queue when the spec says to, as rekordbox does to complete cues on close', async () => {
    const onClosed = vi.fn()
    const { pq, running } = setup({ alwaysWatch: () => true, onClosed })
    pq.watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    running.now = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(onClosed).toHaveBeenCalledTimes(1)
    pq.watch.stop()
  })

  it('does not watch an empty queue without that, so idle programs are never polled', async () => {
    const { pq, deps } = setup()
    pq.watch.poke()
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.processes.engine.isRunning).not.toHaveBeenCalled()
  })
})
