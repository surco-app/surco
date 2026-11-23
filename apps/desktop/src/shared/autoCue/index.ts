import impl from '@surco/auto-cue-impl'
import type { AutoCueEngine } from './engine'

export const autoCue: AutoCueEngine = impl

export type { AutoCueEngine } from './engine'
export type {
  DropInput,
  DropPicking,
  DropProposal,
  DropTaste,
  TasteCheck,
  TasteOutcome,
  TasteRates,
  TasteTrack,
  TreeNode,
  TunedTaste,
} from './types'
