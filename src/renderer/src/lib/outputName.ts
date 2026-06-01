import type { TrackMetadata } from '../../../shared/types'

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
