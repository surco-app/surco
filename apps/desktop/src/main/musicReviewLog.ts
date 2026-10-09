import type { MusicFixOutcome } from '../shared/types'

// What the review's Activity rows need that the IPC calls do not carry: the title of each
// track (main only sees persistent ids) and which run a later undo belongs to.
export function createMusicReviewLog() {
  const titles = new Map<string, string>()
  const groups = new Map<string, string>()
  const backups = new Map<string, { group: string; title: string }>()
  const copies = new Map<string, { group: string; label: string }>()
  let runs = 0
  const titleOf = (persistentId: string) => titles.get(persistentId) ?? persistentId
  return {
    rememberTitles(entries: { persistentId: string; title: string }[]) {
      for (const e of entries) titles.set(e.persistentId, e.title)
    },
    titleOf,
    beginRun: () => `music-review-${++runs}`,
    rememberRun(group: string, outcomes: MusicFixOutcome[]) {
      for (const o of outcomes) {
        groups.set(o.persistentId, group)
        if (o.backupId) backups.set(o.backupId, { group, title: titleOf(o.persistentId) })
      }
    },
    groupOf: (persistentId: string) => groups.get(persistentId),
    backup: (id: string) => backups.get(id),
    rememberCopy(path: string, copy: { group: string; label: string }) {
      copies.set(path, copy)
    },
    copyOf: (path: string) => copies.get(path),
  }
}

export const musicReviewLog = createMusicReviewLog()
