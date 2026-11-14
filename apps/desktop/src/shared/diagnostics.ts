export interface WindowSnapshot {
  heapUsedMb: number
  heapLimitMb: number
  listTracks: number
  source: string | null
  sourceTracks: number | null
}

export interface ProcessSample {
  type: string
  name?: string
  pid: number
  workingSetMb: number
  peakMb: number
}

export interface MemorySample {
  at: number
  processes: ProcessSample[]
  window: WindowSnapshot | null
}

export interface LastCrash {
  reason: string
  exitCode: number
  at: number
}
