const PREFIX = 'serato:'

export function isSeratoContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}

export function seratoFileOf(contentId: string): string {
  return contentId.slice(PREFIX.length)
}
