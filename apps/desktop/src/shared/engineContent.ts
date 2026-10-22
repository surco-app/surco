const PREFIX = 'engine:'

export function engineContentId(trackId: number): string {
  return `${PREFIX}${trackId}`
}

export function isEngineContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}

export function engineTrackId(contentId: string): number | null {
  if (!isEngineContent(contentId)) return null
  const id = Number(contentId.slice(PREFIX.length))
  return Number.isInteger(id) && id > 0 ? id : null
}
