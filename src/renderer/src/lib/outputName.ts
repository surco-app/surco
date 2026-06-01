import type { TrackMetadata } from '../../../shared/types'

// Renders the user's file-name template (e.g. "{artist} - {title}") against a
// track's metadata. Tokens are TrackMetadata keys; unknown tokens and tokens
// whose field is empty collapse to nothing, then leftover separator debris is
// cleaned so a missing token never leaves a dangling " - " in the file name.
export function renderOutputName(format: string, meta: TrackMetadata): string {
  const filled = format.replace(/\{(\w+)\}/g, (_, key) => {
    const value = (meta as Record<string, string>)[key]
    return value ? value.trim() : ''
  })
  return filled
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·_]+|[\s\-–·_]+$/g, '')
    .trim()
}
