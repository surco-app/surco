import { describe, expect, it } from 'vitest'
import type { WindowSnapshot } from '../shared/diagnostics'
import { createCrashState } from './crashState'
import { createMemoryWatch } from './memoryWatch'

const snapshot = (listTracks: number): WindowSnapshot => ({
  heapUsedMb: 100,
  heapLimitMb: 4096,
  listTracks,
  source: null,
  sourceTracks: null,
})

function setup() {
  const watch = createMemoryWatch({
    metrics: () => [],
    now: () => 0,
    logger: { warn: () => {}, error: () => {} },
    highMb: 3072,
    size: 20,
  })
  return { watch, state: createCrashState(watch) }
}

describe('crashState', () => {
  it('starts with no crash, so a clean launch has nothing to report', () => {
    expect(setup().state.last()).toBeNull()
  })

  it('keeps the window snapshot the watch held at crash time, since the reload replaces it', () => {
    const { watch, state } = setup()
    watch.window(snapshot(900))
    state.record({ reason: 'oom', exitCode: 5, at: 1 })
    watch.window(snapshot(0))
    expect(state.last()).toEqual({
      crash: { reason: 'oom', exitCode: 5, at: 1 },
      atCrash: snapshot(900),
    })
  })

  it('records no snapshot when the window never reported one', () => {
    const { state } = setup()
    state.record({ reason: 'crashed', exitCode: 1, at: 2 })
    expect(state.last()?.atCrash).toBeNull()
  })
})
