import type { MemorySample, ProcessSample, WindowSnapshot } from '../shared/diagnostics'

export interface MemoryWatchDeps {
  metrics: () => ProcessSample[]
  now: () => number
  logger: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  highMb: number
  size: number
}

export interface MemoryWatch {
  sample(): void
  window(snapshot: WindowSnapshot): void
  lastWindow(): WindowSnapshot | null
  dump(why: string): void
}

export function createMemoryWatch(deps: MemoryWatchDeps): MemoryWatch {
  let ring: MemorySample[] = []
  let pending = 0
  let lastWindow: WindowSnapshot | null = null
  const above = new Set<number>()

  return {
    sample() {
      const processes = deps.metrics()
      ring.push({ at: deps.now(), processes, window: lastWindow })
      pending += 1
      if (ring.length > deps.size) ring = ring.slice(ring.length - deps.size)
      pending = Math.min(pending, ring.length)
      for (const p of processes) {
        if (p.workingSetMb < deps.highMb) {
          above.delete(p.pid)
        } else if (!above.has(p.pid)) {
          above.add(p.pid)
          deps.logger.warn(`memory high ${p.type} pid ${p.pid} ${p.workingSetMb} MB`)
        }
      }
    },
    window(snapshot) {
      lastWindow = snapshot
    },
    lastWindow: () => lastWindow,
    dump(why) {
      if (pending === 0) {
        deps.logger.error(`memory before ${why}: no samples`)
        return
      }
      deps.logger.error(`memory before ${why}`, ring.slice(ring.length - pending))
      pending = 0
    },
  }
}

export function processSamples(metrics: Electron.ProcessMetric[]): ProcessSample[] {
  return metrics.map((m) => ({
    type: m.type,
    ...(m.name ? { name: m.name } : {}),
    pid: m.pid,
    workingSetMb: Math.round(m.memory.workingSetSize / 1024),
    peakMb: Math.round(m.memory.peakWorkingSetSize / 1024),
  }))
}
