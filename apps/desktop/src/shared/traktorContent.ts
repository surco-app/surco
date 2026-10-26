const PREFIX = 'traktor:'

// Surco's letter i (HOT_KINDS[i]) sits on Traktor's button i + 1: button 1 is Traktor's
// own AutoGrid cue, which Surco never edits.
export const TRAKTOR_HOT_OFFSET = 1

export function traktorContentId(key: string): string {
  return `${PREFIX}${key}`
}

export function isTraktorContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}

export function traktorKey(contentId: string): string | null {
  return isTraktorContent(contentId) ? contentId.slice(PREFIX.length) : null
}
