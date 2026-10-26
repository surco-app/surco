import { type CueSlots, HOT_KINDS } from './cueRules'
import { nearestHotCueColor } from './rekordboxCueColors'

const PREFIX = 'traktor:'

// Surco's letter i (HOT_KINDS[i]) sits on Traktor's button i + 1: button 1 is Traktor's
// own AutoGrid cue, which Surco never edits.
export const TRAKTOR_HOT_OFFSET = 1

// Traktor's own playlists at the root: it recreates or relies on them, so Surco never
// renames or deletes them, and HISTORY is a log nobody edits.
export const TRAKTOR_BUILT_IN = new Set(['Preparation', 'HISTORY', '_LOOPS', '_RECORDINGS'])
export const TRAKTOR_HISTORY = 'HISTORY'

// Buttons 2 to 8 are Surco's, so letters A to G; a hot cue is already a marker in Traktor,
// so no CALL is written beside it.
export const TRAKTOR_SLOTS: CueSlots = { kinds: HOT_KINDS.slice(0, 7), pairCalls: false }

// The blue Traktor gives a plain cue (TYPE 0), the only kind Surco writes there.
export const TRAKTOR_CUE_HEX = '#2f7bff'
export const TRAKTOR_CUE_COLOR = nearestHotCueColor(
  (0xff000000 | Number.parseInt(TRAKTOR_CUE_HEX.slice(1), 16)) >>> 0,
)

export function traktorContentId(key: string): string {
  return `${PREFIX}${key}`
}

export function isTraktorContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}

export function traktorKey(contentId: string): string | null {
  return isTraktorContent(contentId) ? contentId.slice(PREFIX.length) : null
}
