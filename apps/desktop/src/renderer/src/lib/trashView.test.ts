import { describe, expect, it } from 'vitest'
import type { TrashEntry } from '../../../shared/types'
import {
  countByReason,
  daysLeft,
  EXPIRING_SOON_DAYS,
  latestBackupByPath,
  visibleEntries,
} from './trashView'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-09-20T12:00:00Z')

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 'e1',
  name: 'Track.aiff',
  originalPath: '/Music/Crate/Track.aiff',
  storedPath: '/ud/trash/items/e1-Track.aiff',
  bytes: 1024,
  trashedAt: now,
  reason: 'replaced',
  ...over,
})

describe('daysLeft', () => {
  // The only temporal fact worth showing: the trash deletes files by itself, so the row
  // says how long is left, never when it happened. A file stashed a moment ago has the
  // whole retention; one stashed 29 days ago has a day.
  it('counts the retention down from when the file was stashed', () => {
    expect(daysLeft(entry(), 30, now)).toBe(30)
    expect(daysLeft(entry({ trashedAt: now - 29 * DAY }), 30, now)).toBe(1)
  })

  // The sweep runs at launch, so an entry past its retention can still be listed until
  // then. It must not read as "-2 days" or wrap around to a large number.
  it('never goes below zero for an entry the sweep has not reached yet', () => {
    expect(daysLeft(entry({ trashedAt: now - 40 * DAY }), 30, now)).toBe(0)
  })

  // A part-used day still counts as available: a file with 28.4 days left is shown as 29,
  // never rounded down to a number that makes it look closer to deletion than it is.
  it('rounds a partly spent day up so the count never understates what is left', () => {
    expect(daysLeft(entry({ trashedAt: now - 1.6 * DAY }), 30, now)).toBe(29)
  })
})

describe('visibleEntries', () => {
  const list = [
    entry({ id: 'a', name: 'Pray.aiff', reason: 'replaced' }),
    entry({ id: 'b', name: 'Vacation.wav', reason: 'renamed' }),
    entry({
      id: 'c',
      name: 'Goodbye.aiff',
      reason: 'deleted',
      originalPath: '/NAS/Detroit/x.aiff',
    }),
  ]

  it('shows everything under the "all" filter', () => {
    expect(visibleEntries(list, 'all', '').map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps only the chosen reason', () => {
    expect(visibleEntries(list, 'renamed', '').map((e) => e.id)).toEqual(['b'])
  })

  // The query has to reach the folder, not just the name: a DJ looking for what a bad
  // batch did to one crate searches the crate, and every file in it has a different name.
  it('matches the folder as well as the name', () => {
    expect(visibleEntries(list, 'all', 'detroit').map((e) => e.id)).toEqual(['c'])
  })

  // Folded like the track list's own filter, so "cancion" finds "canción" here too and
  // the two search boxes never disagree on what counts as a match.
  it('ignores case and accents on both sides', () => {
    const accented = [entry({ id: 'd', name: 'Canción.aiff' })]
    expect(visibleEntries(accented, 'all', 'cancion').map((e) => e.id)).toEqual(['d'])
    // Typed with the accent and in caps, which is what a keyboard set to Spanish
    // produces: the query has to be folded too, not just the name it is matched against.
    expect(visibleEntries(accented, 'all', 'CANCIÓN').map((e) => e.id)).toEqual(['d'])
  })

  it('combines the filter and the query', () => {
    expect(visibleEntries(list, 'deleted', 'pray')).toEqual([])
  })
})

describe('countByReason', () => {
  // The sidebar shows a count per reason, and it must count the whole trash rather than
  // what the search left on screen — otherwise typing a query makes the totals shrink and
  // the sidebar stops saying what is actually in there.
  it('counts every entry by reason plus a total', () => {
    const counts = countByReason([
      entry({ id: 'a', reason: 'replaced' }),
      entry({ id: 'b', reason: 'replaced' }),
      entry({ id: 'c', reason: 'renamed' }),
    ])
    expect(counts.all).toBe(3)
    expect(counts.replaced).toBe(2)
    expect(counts.renamed).toBe(1)
    expect(counts.deleted).toBe(0)
    expect(counts['restored-over']).toBe(0)
  })
})

describe('EXPIRING_SOON_DAYS', () => {
  // The warning is only worth drawing when it means something: repeating a day count on
  // every row is noise, so the badge appears in the last week and nowhere else.
  it('is the last week of the retention', () => {
    expect(EXPIRING_SOON_DAYS).toBe(7)
  })
})

describe('latestBackupByPath', () => {
  // The track row marks a file that has a backup, and a track's path is either the one
  // the backup came from (a rewrite in place) or the one that took its place (a format
  // change renamed it). Both have to find it, and a track updated twice shows when the
  // most recent copy was taken, since that is the one a restore would bring back first.
  it('finds a backup by the path it came from and by the file that replaced it', () => {
    const map = latestBackupByPath([
      entry({ id: 'a', originalPath: '/Crate/A.aiff', trashedAt: now - DAY }),
      entry({ id: 'b', originalPath: '/Crate/A.aiff', trashedAt: now }),
      entry({
        id: 'c',
        originalPath: '/Crate/B.wav',
        outputPath: '/Crate/B.aiff',
        trashedAt: now - 2 * DAY,
        reason: 'renamed',
      }),
    ])
    expect(map.get('/Crate/A.aiff')).toBe(now)
    expect(map.get('/Crate/B.aiff')).toBe(now - 2 * DAY)
    expect(map.get('/Crate/C.aiff')).toBeUndefined()
  })
})

describe('visibleEntries for a renamed file', () => {
  // A format change renames the file, so the track now answers to B.aiff while its backup
  // is B.wav. Opened from that track's mark, the search is the track's own name, and it
  // has to still find the copy through the file that took its place.
  it('finds a backup by the name of the file that replaced it', () => {
    const renamed = entry({
      name: 'B.wav',
      originalPath: '/Crate/B.wav',
      outputPath: '/Crate/B.aiff',
      reason: 'renamed',
    })
    expect(visibleEntries([renamed], 'all', 'B.aiff')).toEqual([renamed])
  })
})
