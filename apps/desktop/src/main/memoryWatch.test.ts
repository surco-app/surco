import { describe, expect, it, vi } from 'vitest'
import type { MemorySample, ProcessSample, WindowSnapshot } from '../shared/diagnostics'
import { createMemoryWatch, processSamples } from './memoryWatch'

const snapshot = (listTracks: number): WindowSnapshot => ({
  heapUsedMb: 100,
  heapLimitMb: 4096,
  listTracks,
  source: null,
  sourceTracks: null,
})

function setup(size = 20, mb = 100) {
  let clock = 0
  let workingSetMb = mb
  const logger = { warn: vi.fn(), error: vi.fn() }
  const watch = createMemoryWatch({
    metrics: (): ProcessSample[] => [{ type: 'Tab', pid: 7, workingSetMb, peakMb: workingSetMb }],
    now: () => ++clock,
    logger,
    highMb: 3072,
    size,
  })
  return {
    watch,
    logger,
    setMb: (value: number) => {
      workingSetMb = value
    },
  }
}

const dumped = (logger: { error: ReturnType<typeof vi.fn> }, call: number): MemorySample[] =>
  logger.error.mock.calls[call][1] as MemorySample[]

describe('memory watch', () => {
  it('keeps only the last size samples, so a long session never grows the ring', () => {
    const { watch, logger } = setup(3)
    for (let i = 0; i < 5; i++) watch.sample()
    watch.dump('x')
    expect(logger.error).toHaveBeenCalledTimes(1)
    const samples = dumped(logger, 0)
    expect(samples).toHaveLength(3)
    expect(samples[0].at).toBe(3)
  })

  it('dumps nothing twice, so a renderer dying four times in a row reports each stretch once', () => {
    const { watch, logger } = setup()
    watch.sample()
    watch.dump('a')
    watch.sample()
    watch.dump('b')
    expect(dumped(logger, 1)).toHaveLength(1)
  })

  it('says there were no samples instead of throwing when the window dies in its first 30 s', () => {
    const { watch, logger } = setup()
    expect(() => watch.dump('x')).not.toThrow()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0][0])).toContain('no samples')
  })

  it('warns once per crossing, so a process sitting above the threshold does not flood the log', () => {
    const { watch, logger, setMb } = setup()
    setMb(4000)
    for (let i = 0; i < 3; i++) watch.sample()
    setMb(1000)
    watch.sample()
    setMb(4000)
    watch.sample()
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('stamps every sample with the last window snapshot so a dump after a crash shows what the window held', () => {
    const { watch, logger } = setup()
    watch.window(snapshot(8001))
    watch.sample()
    watch.dump('x')
    expect(dumped(logger, 0)[0].window?.listTracks).toBe(8001)
    expect(watch.lastWindow()?.listTracks).toBe(8001)
  })
})

describe('processSamples', () => {
  it('converts Electron metrics from KB to MB', () => {
    const metrics = [
      { type: 'Tab', pid: 1, memory: { workingSetSize: 2048, peakWorkingSetSize: 4096 } },
    ] as Electron.ProcessMetric[]
    expect(processSamples(metrics)).toEqual([
      { type: 'Tab', pid: 1, workingSetMb: 2, peakMb: 4 },
    ])
  })
})
