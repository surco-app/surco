const PREFIX = 'virtualdj:'

export function isVirtualdjContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}

export function virtualdjFileOf(contentId: string): string {
  return contentId.slice(PREFIX.length)
}
