import type { FlowPhrase } from '../cueFlows'

export interface DropInput {
  grid: { ms: number; beat: number }[]
  phrases: FlowPhrase[]
  words: Uint16Array
}

export interface DropProposal {
  ms: number
  sure: boolean
  quietBars: number
}

export interface DropPicking {
  threshold: number
  spacingBars: number
  maxDrops: number
}

export type TreeNode =
  | [feature: number, threshold: number, left: number, right: number]
  | [value: number]

export interface DropTaste {
  trees: TreeNode[][]
  picking: DropPicking
}

export type TasteOutcome = 'accepted' | 'corrected' | 'manual'

export interface TasteTrack {
  key: string
  candidates: { bar: number; features: number[] }[]
  drops: number[]
  outcome?: TasteOutcome
}

export interface TasteRates {
  found: number
  right: number
}

export interface TasteCheck {
  tracks: number
  checked: number
  before: TasteRates
  after: TasteRates
}

export interface TunedTaste {
  taste: DropTaste | null
  check: TasteCheck
}
