import type { AutoCueEngine } from '../engine'
import { dropProposals } from './dropDetect'
import { MIN_TASTE_TRACKS, modelWithTaste, tasteTrackOf, tuneDropTaste } from './dropTaste'

const engine: AutoCueEngine = {
  canLearn: true,
  minTasteTracks: MIN_TASTE_TRACKS,
  dropProposals: (input, taste) => dropProposals(input, modelWithTaste(taste)),
  tasteTrackOf: (input, drops, proposedWith) =>
    tasteTrackOf(input, drops, proposedWith ? modelWithTaste(proposedWith.taste) : undefined),
  tuneDropTaste: (tracks) => tuneDropTaste(tracks),
}

export default engine
