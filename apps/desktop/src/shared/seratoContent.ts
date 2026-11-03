const PREFIX = 'serato:'

export function isSeratoContent(contentId: string): boolean {
  return contentId.startsWith(PREFIX)
}
