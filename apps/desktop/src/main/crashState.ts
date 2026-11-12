import type { LastCrash, WindowSnapshot } from '../shared/diagnostics'
import type { MemoryWatch } from './memoryWatch'

export interface RecordedCrash {
  crash: LastCrash
  atCrash: WindowSnapshot | null
}

export interface CrashState {
  watch: MemoryWatch
  record(crash: LastCrash): void
  last(): RecordedCrash | null
}

export function createCrashState(watch: MemoryWatch): CrashState {
  let recorded: RecordedCrash | null = null
  return {
    watch,
    record(crash) {
      recorded = { crash, atCrash: watch.lastWindow() }
    },
    last: () => recorded,
  }
}
