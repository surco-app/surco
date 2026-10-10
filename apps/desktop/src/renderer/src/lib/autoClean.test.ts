import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { ReviewRawFields, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  type AutoCleanOptions,
  activeCleanups,
  applyAutoClean,
  cleanReasons,
  cleanupPatcher,
  planAutoClean,
  undoCleanup,
} from './autoClean'
import { trackSignature } from './dirty'
import { spellingGroups } from './musicSpelling'

let n = 0
function row(
  fields: Partial<TrackMetadata>,
  raw?: ReviewRawFields,
  over: Partial<TrackItem> = {},
): TrackItem {
  n += 1
  const path = `/m/${n}.aiff`
  const meta = { ...emptyMetadata(), title: `T${n}`, ...fields }
  const diskSignature = trackSignature({ meta })
  return {
    id: `id${n}`,
    inputPath: path,
    fileName: path,
    listLabel: meta.title,
    query: '',
    status: 'idle',
    meta,
    diskSignature,
    ...(raw && { reviewRaw: { signature: diskSignature, fields: raw } }),
    ...over,
  }
}

const many = (count: number, fields: Partial<TrackMetadata>) =>
  Array.from({ length: count }, () => row(fields))

function opts(rows: TrackItem[], over: Partial<AutoCleanOptions> = {}): AutoCleanOptions {
  return {
    targets: new Set(rows.map((r) => r.inputPath)),
    spacing: true,
    unifyCase: true,
    ignored: [],
    editing: null,
    ...over,
  }
}

const plan = (rows: TrackItem[], over: Partial<AutoCleanOptions> = {}) =>
  planAutoClean(rows, opts(rows, over))

describe('planAutoClean spacing', () => {
  it('collapses doubled spaces and drops invisible characters in the five reviewed fields', () => {
    const r = row({
      title: 'Mayday  (Original mix)',
      artist: 'Head​ Horny',
      albumArtist: 'Head  Horny',
      album: 'Fuego﻿ EP',
      genre: 'Tech  House',
    })
    expect(plan([r], { unifyCase: false })).toEqual([
      {
        id: r.id,
        field: 'title',
        raw: 'Mayday  (Original mix)',
        before: 'Mayday  (Original mix)',
        to: 'Mayday (Original mix)',
      },
      { id: r.id, field: 'artist', raw: 'Head​ Horny', before: 'Head​ Horny', to: 'Head Horny' },
      {
        id: r.id,
        field: 'albumArtist',
        raw: 'Head  Horny',
        before: 'Head  Horny',
        to: 'Head Horny',
      },
      { id: r.id, field: 'album', raw: 'Fuego﻿ EP', before: 'Fuego﻿ EP', to: 'Fuego EP' },
      { id: r.id, field: 'genre', raw: 'Tech  House', before: 'Tech  House', to: 'Tech House' },
    ])
  })

  it('reads the untrimmed spelling the file carries, since every read already trims', () => {
    const r = row({ title: 'Mayday' }, { title: ' Mayday' })
    expect(plan([r])).toEqual([
      { id: r.id, field: 'title', raw: ' Mayday', before: 'Mayday', to: 'Mayday' },
    ])
  })

  it('leaves apostrophes and every other punctuation variant to the review', () => {
    const rows = [row({ artist: 'Head Horny´s' }), row({ title: 'Don’t  Stop' })]
    expect(plan(rows, { unifyCase: false }).map((f) => f.to)).toEqual(['Don’t Stop'])
  })

  it('agrees with the review about what is not clean', () => {
    const r = row({ album: 'Connected‪  Vol.3' })
    const [fix] = plan([r], { unifyCase: false })
    const [group] = spellingGroups([
      {
        id: r.inputPath,
        title: '',
        artist: '',
        albumArtist: '',
        album: r.meta.album ?? '',
        genre: '',
      },
    ])
    expect(group.kind).toBe('invisible')
    expect(fix.to).toBe(group.suggested)
  })

  it('does nothing while the setting is off', () => {
    expect(plan([row({ title: 'A  B' })], { spacing: false, unifyCase: false })).toEqual([])
  })
})

// The user's own words always win: a field they already changed is theirs, not the file's.
describe('planAutoClean never overwrites an edit', () => {
  it('skips a field whose live value is no longer what was read from the file', () => {
    const r = row({ title: 'A  B', artist: 'X  Y' })
    const edited = { ...r, meta: { ...r.meta, title: 'Typed by hand' } }
    expect(plan([edited], { unifyCase: false }).map((f) => f.field)).toEqual(['artist'])
  })

  it('skips the row whose field is being typed into', () => {
    const r = row({ title: 'A  B' })
    expect(plan([r], { editing: r.id })).toEqual([])
  })

  it('never cleans a field again once cleaned or undone', () => {
    const r = row({ title: 'A  B' })
    const undone = {
      ...r,
      cleaned: { title: { raw: 'A  B', before: 'A  B', to: 'A B', undone: true } },
    }
    expect(plan([undone])).toEqual([])
  })
})

// A row still reading, or whose read failed, holds a file-name parse, not the file's tags.
describe('planAutoClean only reads rows the review would read', () => {
  it('leaves out rows not read yet, failed, converting or without a disk read', () => {
    const rows = [
      row({ title: 'A  B' }, undefined, { loadingMeta: true }),
      row({ title: 'A  B' }, undefined, { metaReadFailed: true }),
      row({ title: 'A  B' }, undefined, { status: 'processing' }),
      row({ title: 'A  B' }, undefined, { diskSignature: undefined }),
    ]
    expect(plan(rows)).toEqual([])
  })

  it('only touches the rows of this load', () => {
    const [a, b] = [row({ title: 'A  B' }), row({ title: 'C  D' })]
    expect(plan([a, b], { targets: new Set([b.inputPath]) }).map((f) => f.id)).toEqual([b.id])
  })
})

describe('planAutoClean case', () => {
  it('writes a name the way the list clearly prefers', () => {
    const minority = row({ artist: 'Dj Lara' })
    const rows = [...many(11, { artist: 'DJ Lara' }), minority]
    expect(plan(rows)).toEqual([
      { id: minority.id, field: 'artist', raw: 'Dj Lara', before: 'Dj Lara', to: 'DJ Lara' },
    ])
  })

  // At least 3 tracks and at least twice every other spelling. Anything closer is a coin toss.
  it.each([
    [4, 2, true],
    [3, 1, true],
    [2, 1, false],
    [4, 3, false],
    [3, 3, false],
  ])('with %i against %i the list unifies: %s', (top, other, unified) => {
    const rows = [
      ...many(top, { album: 'Fuego EP', artist: 'K' }),
      ...many(other, { album: 'FUEGO EP', artist: 'K' }),
    ]
    expect(plan(rows).length > 0).toBe(unified)
  })

  it('folds accents as the review does', () => {
    const minority = row({ artist: 'Aaron Alfonso' })
    const rows = [...many(3, { artist: 'Aarón Alfonso' }), minority]
    expect(plan(rows).map((f) => f.to)).toEqual(['Aarón Alfonso'])
  })

  it('renames one act inside a collaboration and keeps the rest as written', () => {
    const collab = row({ artist: 'Dj Lara & Someone' })
    const rows = [...many(3, { artist: 'DJ Lara' }), collab]
    expect(plan(rows).map((f) => f.to)).toEqual(['DJ Lara & Someone'])
  })

  it('counts the whole list but only changes the rows of this load', () => {
    const minority = row({ artist: 'Dj Lara' })
    const rows = [...many(3, { artist: 'DJ Lara' }), minority]
    expect(plan(rows, { targets: new Set(rows.slice(0, 3).map((r) => r.inputPath)) })).toEqual([])
  })

  it('never fixes a typo, however clear the majority', () => {
    const rows = [
      ...many(6, { artist: 'Francesco Donadoni' }),
      row({ artist: 'Francesco Donadomi' }),
    ]
    expect(plan(rows)).toEqual([])
  })

  it('does nothing while the setting is off', () => {
    const rows = [...many(4, { artist: 'DJ Lara' }), row({ artist: 'Dj Lara' })]
    expect(plan(rows, { unifyCase: false })).toEqual([])
  })

  it('unifies a value the spacing setting left trimmed, without putting the spaces back', () => {
    const minority = row({ artist: 'Dj Lara' }, { artist: 'Dj Lara ' })
    const rows = [...many(3, { artist: 'DJ Lara' }), minority]
    expect(plan(rows, { spacing: false })).toEqual([
      { id: minority.id, field: 'artist', raw: 'Dj Lara ', before: 'Dj Lara', to: 'DJ Lara' },
    ])
  })
})

describe('planAutoClean respects what the review ignores', () => {
  it('leaves an ignored invisible group alone', () => {
    const r = row({ title: 'A  B' })
    const [group] = spellingGroups([
      { id: r.inputPath, title: 'A  B', artist: '', albumArtist: '', album: '', genre: '' },
    ])
    expect(plan([r], { ignored: [group.key] })).toEqual([])
  })

  it('leaves an ignored case group alone', () => {
    const rows = [...many(4, { artist: 'DJ Lara' }), row({ artist: 'Dj Lara' })]
    const entries = rows.map((r) => ({
      id: r.inputPath,
      title: r.meta.title,
      artist: r.meta.artist,
      albumArtist: '',
      album: '',
      genre: '',
    }))
    const keys = spellingGroups(entries).map((g) => g.key)
    expect(plan(rows, { ignored: keys })).toEqual([])
  })
})

describe('applyAutoClean', () => {
  it('stages the cleaned value on the row with its record', () => {
    const r = row({ title: 'A  B' })
    const [next] = applyAutoClean([r], plan([r]))
    expect(next.meta.title).toBe('A B')
    expect(next.cleaned).toEqual({ title: { raw: 'A  B', before: 'A  B', to: 'A B' } })
  })

  // The plan is read from a ref; an edit can land between the plan and the write.
  it('drops a fix whose field changed after it was planned', () => {
    const r = row({ title: 'A  B' })
    const fixes = plan([r])
    const typed = { ...r, meta: { ...r.meta, title: 'Mine' } }
    const [next] = applyAutoClean([typed], fixes)
    expect(next).toBe(typed)
  })

  it('returns untouched rows as they were', () => {
    const [a, b] = [row({ title: 'A  B' }), row({ title: 'Clean' })]
    const next = applyAutoClean([a, b], plan([a, b]))
    expect(next[1]).toBe(b)
  })
})

// The ref and the state get the same patch: auto-match tells an edit from its own probe by
// the identity of meta, so two copies of the same clean-up would read as an edit.
describe('cleanupPatcher', () => {
  it('hands the ref and the state the very same cleaned meta', () => {
    const r = row({ title: 'A  B' })
    const stage = cleanupPatcher([r], plan([r]))
    const inRef = stage(r)
    const inState = stage({ ...r })
    expect(inRef.meta.title).toBe('A B')
    expect(inState.meta).toBe(inRef.meta)
    expect(inState.cleaned).toEqual(inRef.cleaned)
  })

  it('leaves a row whose meta moved on since the plan', () => {
    const r = row({ title: 'A  B' })
    const stage = cleanupPatcher([r], plan([r]))
    const later = { ...r, meta: { ...r.meta, genre: 'House' } }
    expect(stage(later)).toBe(later)
  })
})

describe('activeCleanups and undoCleanup', () => {
  const cleanedRow = () => {
    const r = row({ title: 'A  B', artist: 'X  Y' })
    return applyAutoClean([r], plan([r]))[0]
  }

  it('lists the fields that still hold their cleaned value', () => {
    const r = cleanedRow()
    expect(activeCleanups(r)).toEqual(['title', 'artist'])
    expect(activeCleanups({ ...r, meta: { ...r.meta, title: 'Mine' } })).toEqual(['artist'])
  })

  it('puts the value as read back and keeps the field from being cleaned again', () => {
    const r = cleanedRow()
    const undone = { ...r, ...undoCleanup(r, 'title') }
    expect(undone.meta.title).toBe('A  B')
    expect(undone.meta.artist).toBe('X Y')
    expect(activeCleanups(undone)).toEqual(['artist'])
    expect(planAutoClean([undone], opts([undone]))).toEqual([])
  })

  // Typing the same text by hand after an undo is the user's edit, not the clean-up's.
  it('does not claim a value the user typed after undoing', () => {
    const r = cleanedRow()
    const undone = { ...r, ...undoCleanup(r, 'title') }
    const retyped = { ...undone, meta: { ...undone.meta, title: 'A B' } }
    expect(activeCleanups(retyped)).toEqual(['artist'])
  })

  it('has nothing to undo once the user changed the field', () => {
    const r = cleanedRow()
    expect(undoCleanup({ ...r, meta: { ...r.meta, title: 'Mine' } }, 'title')).toBeNull()
  })
})

describe('cleanReasons', () => {
  it('names each thing the clean-up removed', () => {
    expect(cleanReasons(' Mayday', 'Mayday')).toEqual([{ reason: 'leading', count: 1 }])
    expect(cleanReasons('Mayday  ', 'Mayday')).toEqual([{ reason: 'trailing', count: 2 }])
    expect(cleanReasons('May  day', 'May day')).toEqual([{ reason: 'inner', count: 1 }])
    expect(cleanReasons('May​day', 'Mayday')).toEqual([{ reason: 'invisible', count: 1 }])
    expect(cleanReasons('Dj Lara', 'DJ Lara')).toEqual([{ reason: 'case', count: 1 }])
    expect(cleanReasons(' Dj﻿  Lara', 'DJ Lara')).toEqual([
      { reason: 'leading', count: 1 },
      { reason: 'inner', count: 1 },
      { reason: 'invisible', count: 1 },
      { reason: 'case', count: 1 },
    ])
  })
})
