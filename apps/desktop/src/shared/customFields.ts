// The tag a custom field is written under: its key upper-cased, the convention mp3tag and
// TagScanner follow for fields of their own. A file tagged elsewhere with any casing still
// reads back, since the reader compares names case-insensitively.
export function customTagName(key: string): string {
  return key.toUpperCase()
}
