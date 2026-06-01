import type {
  Settings,
  DiscogsSearchResult,
  DiscogsRelease,
  ProcessJob,
  ProcessResult
} from '../shared/types'

export interface Api {
  getPathForFile: (file: File) => string
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  pickFiles: () => Promise<string[]>
  pickOutputDir: () => Promise<string | null>
  searchDiscogs: (query: string) => Promise<DiscogsSearchResult[]>
  getRelease: (id: number) => Promise<DiscogsRelease>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  reveal: (path: string) => Promise<void>
  onOpenSettings: (cb: () => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
