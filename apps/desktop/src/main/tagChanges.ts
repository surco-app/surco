import { diffSnapshots, snapshotTags } from './tagSnapshot'

// What a conversion did to the file's tags, in the terms the activity panel shows: how
// many fields it changed, how many it left as they were, and which ones changed. A user
// found four defects in one update by putting the file through mp3tag before and after
// (17/09/2026); this hands him that comparison on every conversion, so a field renamed,
// invented or lost shows up in the panel the moment it happens.
export interface TagChangeSummary {
  changed: number
  kept: number
  fields: string[]
}

// The field a snapshot line describes, in the name the user knows it by: the Vorbis
// field, the ID3 frame (a TXXX by its description), the INFO id, the iTunes atom.
export function fieldOf(line: string): string {
  const m = line.match(/^(\w+) ([^=[ ]+)(?:\[([^\]]*)\])?/)
  if (!m) return line
  const [, family, name, bracket] = m
  // A picture block and the presence markers carry no field name of their own.
  if (family === 'picture' || family === 'id3v1' || family === 'ape' || family === 'flac')
    return family
  if (name === 'TXXX' && bracket) return `TXXX:${bracket}`
  return name
}

export function summarizeTagChanges(before: string[], after: string[]): TagChangeSummary {
  const { added, removed } = diffSnapshots(before, after)
  const changed = new Set([...added, ...removed].map(fieldOf))
  const kept = new Set(after.filter((l) => !changed.has(fieldOf(l))).map(fieldOf))
  return { changed: changed.size, kept: kept.size, fields: [...changed].sort() }
}

// The activity row's done detail, translated by the renderer. Null when either side
// could not be read: a summary that cannot be trusted must not claim anything.
export function tagChangeDetail(
  before: string[] | null,
  after: string[] | null,
): { detailKey: string; detailParams: Record<string, string | number> } | null {
  if (!before || !after) return null
  const summary = summarizeTagChanges(before, after)
  if (summary.changed === 0)
    return { detailKey: 'activity.convertTagsUnchanged', detailParams: { kept: summary.kept } }
  return {
    detailKey: 'activity.convertTagsChanged',
    detailParams: {
      changed: summary.changed,
      kept: summary.kept,
      fields: summary.fields.slice(0, 6).join(', ') + (summary.fields.length > 6 ? '…' : ''),
    },
  }
}

// A snapshot that never throws: a file TagLib cannot open (or that is gone, as a replaced
// original is) yields null, and tagChangeDetail then stays silent.
export function snapshotTagsOrNull(file: string): string[] | null {
  try {
    return snapshotTags(file)
  } catch {
    return null
  }
}
