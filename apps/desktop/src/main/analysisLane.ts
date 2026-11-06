import { AsyncLocalStorage } from 'node:async_hooks'

export type AnalysisLane = 'urgent' | 'high' | 'low'

const lane = new AsyncLocalStorage<AnalysisLane>()

export function currentAnalysisLane(): AnalysisLane | undefined {
  return lane.getStore()
}

export function inAnalysisLane<T>(priority: AnalysisLane, task: () => Promise<T>): Promise<T> {
  return lane.run(priority, task)
}
