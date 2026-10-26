import { nearestHotCueColor } from './rekordboxCueColors'

const PREFIX = 'traktor:'

// Surco's letter i (HOT_KINDS[i]) sits on Traktor's button i + 1: button 1 is Traktor's
// own AutoGrid cue, which Surco never edits.
export const TRAKTOR_HOT_OFFSET = 1

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
