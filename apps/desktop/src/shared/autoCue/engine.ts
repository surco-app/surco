import type { DropInput, DropProposal, DropTaste, TasteTrack, TunedTaste } from './types'

export interface AutoCueEngine {
  readonly canLearn: boolean
  readonly minTasteTracks: number
  dropProposals(input: DropInput, taste: DropTaste | null): DropProposal[]
  tasteTrackOf(
    input: DropInput,
    drops: number[],
    proposedWith?: { taste: DropTaste | null },
  ): TasteTrack | null
  tuneDropTaste(tracks: TasteTrack[]): TunedTaste | null
}
