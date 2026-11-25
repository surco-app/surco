import { describe, expect, it, vi } from 'vitest'
import { MATCHING_ID } from '../../../shared/matching'
import { TO_REVIEW_ID } from '../../../shared/toReview'
import type { Settings, SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  blocksOf,
  blocksWith,
  distinctById,
  type ListScopeContext,
  listScopeFlags,
  playlistMembership,
  playlistPositions,
  playlistView,
  rowKeys,
  type ToolbarScopeContext,
  toolbarScopeFlags,
} from './playlistView'
import { EMPTY_FILTER } from './triage'

function track(id: string, inputPath: string): TrackItem {
  return { id, inputPath } as TrackItem
}

function entry(path: string | null, separator = false, linkId?: string): SourcePlaylistEntry {
  return { path, separator, meta: {}, linkId, contentId: linkId && `c-${linkId}` }
}

const A = track('a', '/m/A.wav')
const B = track('b', '/m/B.wav')
const C = track('c', '/m/C.wav')
const SEP = '/m/Blank Audio/_.mp3'

describe('playlistView', () => {
  it('finds a track a conversion moved under the path the playlist still lists', () => {
    const moved = { ...A, inputPath: '/m/A.aiff', movedFrom: ['/m/A.wav'] }
    expect(playlistView([moved], [entry('/m/A.wav')]).tracks).toEqual([moved])
    expect(playlistMembership([entry('/m/A.wav')])(moved)).toBe(true)
  })

  it('shows only the playlist tracks, in the playlist order, not the order they were loaded', () => {
    const view = playlistView([A, B, C], [entry('/m/C.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('marks the track after each separator, so the list can draw the break', () => {
    const view = playlistView(
      [A, B],
      [entry('/m/A.wav', false, 'l1'), entry(SEP, true, 's1'), entry('/m/B.wav', false, 'l2')],
    )
    expect([...view.separatorBefore]).toEqual([['b', ['s1']]])
  })

  // A separator with no playlist row of its own is keyed by where it sits, not by its index
  // in the whole playlist: a row added higher up shifted every index below it and React
  // redrew each separator line as new.
  it('keys a separator without a row id the same after a row is added above it', () => {
    const before = playlistView([A, B, C], [entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')])
    const after = playlistView(
      [A, B, C],
      [entry('/m/C.wav'), entry('/m/A.wav'), entry(SEP, true), entry('/m/B.wav')],
    )
    expect(after.separatorBefore.get('b')).toEqual(before.separatorBefore.get('b'))
  })

  // Separators can be moved and removed now; one hidden in a collapsed run, or one after the
  // last row, could never be reached. Each stays its own line.
  it('keeps every separator as its own line, side by side and after the last row', () => {
    const view = playlistView(
      [A, B],
      [
        entry(SEP, true, 's0'),
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry(SEP, true, 's2'),
        entry('/m/B.wav', false, 'l2'),
        entry(SEP, true, 's3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ a: ['s0'], b: ['s1', 's2'] })
    expect(view.trailingSeparators).toEqual(['s3'])
  })

  // A track shown once stands for its first row in the playlist: that is the row a drag
  // moves, and the entry another playlist links to when it is copied.
  it('gives each shown track the moment its program added it, whichever way the program says it', () => {
    const view = playlistView(
      [A, B, C],
      [
        { ...entry('/m/A.wav'), meta: { dateAdded: '2026-05-02' } },
        { ...entry('/m/B.wav'), meta: { addedAt: 1_700_000_000_000 } },
        entry('/m/C.wav'),
      ],
    )
    expect(view.addedOf).toEqual(
      new Map([
        ['a', Date.parse('2026-05-02')],
        ['b', 1_700_000_000_000],
      ]),
    )
  })

  it('gives each shown track the link of its first row and its collection entry', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry('/m/B.wav', false, 'l2'),
        entry('/m/A.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.linkOf)).toEqual({ a: 'l1', b: 'l2' })
    expect(Object.fromEntries(view.contentOf)).toEqual({ a: 'c-l1', b: 'c-l2' })
  })

  // A drag moves every row of a track the playlist holds twice: moving only the first would
  // leave the second in place, and when it then came first the list would show the track
  // there, not where it was dropped.
  it('gives each shown track every link it has in the playlist, in order', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry('/m/B.wav', false, 'l2'),
        entry('/m/A.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.linksOf)).toEqual({ a: ['l1', 'l3'], b: ['l2'] })
  })

  // A separator before a row Surco does not show (a missing file) still breaks the set; it
  // is drawn above the next row that is shown.
  it('carries a separator over a row the list does not show', () => {
    const view = playlistView(
      [A, B],
      [
        entry('/m/A.wav', false, 'l1'),
        entry(SEP, true, 's1'),
        entry('/m/gone.wav', false, 'l2'),
        entry('/m/B.wav', false, 'l3'),
      ],
    )
    expect(Object.fromEntries(view.separatorBefore)).toEqual({ b: ['s1'] })
  })

  it('shows a track the playlist holds twice only once, at its first place', () => {
    const view = playlistView([A, B], [entry('/m/A.wav'), entry('/m/B.wav'), entry('/m/A.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('finds a track whose path the NAS spells decomposed, whichever side holds the decomposed form', () => {
    const view = playlistView(
      [track('n', '/m/Niña.wav'), track('m', '/m/Cañon.wav')],
      [entry('/m/Niña.wav'), entry('/m/Cañon.wav')],
    )
    expect(view.tracks.map((t) => t.id)).toEqual(['n', 'm'])
  })

  // No row to draw a break above, but the separators are still the playlist's: they stay as
  // trailing lines so they can be dragged or removed.
  it('shows no rows for a playlist of only separators, keeping them as trailing lines', () => {
    const view = playlistView([A], [entry(SEP, true, 's1'), entry(SEP, true, 's2')])
    expect(view.tracks).toEqual([])
    expect(view.separatorBefore.size).toBe(0)
    expect(view.trailingSeparators).toEqual(['s1', 's2'])
  })

  it('skips rows not loaded yet instead of holding a gap', () => {
    const view = playlistView([B], [entry('/m/A.wav'), entry('/m/B.wav'), entry(null)])
    expect(view.tracks.map((t) => t.id)).toEqual(['b'])
  })

  // A conversion that is not in place leaves the input where it was and repoints the
  // rekordbox row at the output, so the re-read playlist names the converted file.
  it('shows a converted track where the playlist now names its output', () => {
    const converted = { ...track('a', '/m/A.wav'), outputPath: '/out/A.aiff' } as TrackItem
    const view = playlistView([converted, B], [entry('/out/A.aiff'), entry('/m/B.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('prefers the track loaded from a file over one that converted into it', () => {
    const converted = { ...track('a', '/m/A.wav'), outputPath: '/m/B.wav' } as TrackItem
    const view = playlistView([converted, B], [entry('/m/B.wav')])
    expect(view.tracks.map((t) => t.id)).toEqual(['b'])
  })

  // Every metadata flush hands a new track list; with 8000 tracks the list, its filters and
  // the cue lookups all key on the playlist's layout, and a new one rebuilt them on each edit.
  it('keeps the layout of the previous view across a flush that moves no track', () => {
    const entries = [
      entry('/m/A.wav', false, 'l1'),
      entry(SEP, true, 's1'),
      entry('/m/B.wav', false, 'l2'),
    ]
    const before = playlistView([A, B], entries)
    const edited = { ...A, listLabel: 'edited' } as TrackItem
    const after = playlistView([edited, B], entries, before)
    expect(after.tracks).toEqual([edited, B])
    expect(after.ids).toBe(before.ids)
    expect(after.contentOf).toBe(before.contentOf)
    expect(after.separatorBefore).toBe(before.separatorBefore)
    expect(after.linksOf).toBe(before.linksOf)
    expect(after.pathOf).toBe(before.pathOf)
  })

  it('lays the playlist out again when a flush renames a track it shows', () => {
    const entries = [entry('/m/A.wav', false, 'l1'), entry('/m/B.wav', false, 'l2')]
    const before = playlistView([A, B], entries)
    const renamed = { ...A, inputPath: '/m/A.aiff', movedFrom: ['/m/A.wav'] }
    const after = playlistView([renamed, B], entries, before)
    expect(after.pathOf.get('a')).toBe('/m/A.aiff')
    expect(after.contentOf).not.toBe(before.contentOf)
  })

  it('shows a track again in every Matching block it belongs to, so each block reads whole', () => {
    const D = track('d', '/m/D.wav')
    const entries = [
      entry('/m/A.wav'),
      entry('/m/B.wav'),
      entry('/m/C.wav'),
      entry(SEP, true, 's1'),
      entry('/m/C.wav'),
      entry('/m/D.wav'),
    ]
    const view = playlistView([A, B, C, D], entries, null, { repeats: true })
    expect(view.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'c', 'd'])
    expect(view.separatorBefore.has('c~1')).toBe(true)
    expect(view.separatorBefore.has('c')).toBe(false)
  })

  it('shows a track once in any other playlist, where a second row is the same track', () => {
    const D = track('d', '/m/D.wav')
    const entries = [
      entry('/m/A.wav'),
      entry('/m/B.wav'),
      entry('/m/C.wav'),
      entry(SEP, true, 's1'),
      entry('/m/C.wav'),
      entry('/m/D.wav'),
    ]
    expect(playlistView([A, B, C, D], entries).tracks.map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('lays the playlist out again when its rows change', () => {
    const before = playlistView([A, B], [entry('/m/A.wav', false, 'l1')])
    const after = playlistView([A, B], [entry('/m/A.wav', false, 'l1')], before)
    expect(after.contentOf).not.toBe(before.contentOf)
  })
})

describe('playlistMembership', () => {
  // The background sweeps keep the open playlist's work and set the rest aside: a track the
  // playlist reaches through its converted file, or under the NAS's decomposed spelling, is
  // still that playlist's work and must not be set aside.
  it('finds a track by its input or its output, whatever the spelling', () => {
    const inPlaylist = playlistMembership([entry('/m/Niña.wav'), entry('/out/A.aiff')])
    expect(inPlaylist(track('n', '/m/Niña.wav'))).toBe(true)
    expect(inPlaylist({ ...track('a', '/m/A.wav'), outputPath: '/out/A.aiff' })).toBe(true)
    expect(inPlaylist(B)).toBe(false)
  })

  // A separator is rekordbox's blank-audio file, not a track of the set.
  it('leaves the separator file out', () => {
    expect(playlistMembership([entry(SEP, true)])(track('s', SEP))).toBe(false)
  })
  // The sweeps ask about every loaded track on every flush; a track that did not change
  // must not have its paths spelled again each time.
  it('spells the paths of a track it already asked about only once', () => {
    const inPlaylist = playlistMembership([entry('/m/A.wav')])
    const moved = { ...B, movedFrom: ['/m/old.wav'], outputPath: '/out/B.aiff' }
    inPlaylist(moved)
    const normalize = vi.spyOn(String.prototype, 'normalize')
    try {
      expect(inPlaylist(moved)).toBe(false)
      expect(normalize).not.toHaveBeenCalled()
    } finally {
      normalize.mockRestore()
    }
  })
})

describe('blocksOf', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  const breaks = new Map([['c', ['s1']]])

  it('keeps every block a chosen track belongs to, whole', () => {
    expect(blocksOf(rows, breaks, new Set(['b'])).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('keeps every track while none is chosen in the list, so the playlist is never empty', () => {
    expect(blocksOf(rows, breaks, new Set(['elsewhere'])).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })
})

describe('blocksOf with a track in two blocks', () => {
  const rows = ['a', 'c', 'c', 'd'].map((id) => ({ id }))
  const breaks = new Map([['c~1', ['s1']]])

  it('puts a chosen track in the new playlist once, though two blocks hold it', () => {
    expect(blocksOf(rows, breaks, new Set(['c'])).map((r) => r.id)).toEqual(['a', 'c', 'd'])
  })

  it('puts every track in once when none is chosen', () => {
    expect(blocksOf(rows, breaks, new Set()).map((r) => r.id)).toEqual(['a', 'c', 'd'])
  })
})

describe('rowKeys', () => {
  it('keys each repeat of a track apart, so React and the separators can tell the rows apart', () => {
    expect(rowKeys(['a', 'c', 'c', 'c'].map((id) => ({ id })))).toEqual(['a', 'c', 'c~1', 'c~2'])
  })
})

// The number on a row is where the track sits in the playlist, the one a DJ reads off
// rekordbox, so a search or a filter must not renumber what is left on screen.
describe('playlistPositions', () => {
  const ids = (list: string[]) => list.map((id) => ({ id }))

  it('numbers every row of the playlist from one', () => {
    expect(playlistPositions(ids(['a', 'b', 'c']), ids(['a', 'b', 'c']))).toEqual([1, 2, 3])
  })

  it('keeps the playlist number of the rows a search leaves on screen', () => {
    expect(playlistPositions(ids(['a', 'b', 'c', 'd']), ids(['b', 'd']))).toEqual([2, 4])
  })

  it('numbers each repeat of a track by its own place', () => {
    expect(playlistPositions(ids(['a', 'c', 'b', 'c']), ids(['c', 'b', 'c']))).toEqual([2, 3, 4])
  })

  it('leaves a row the playlist does not hold without a number', () => {
    expect(playlistPositions(ids(['a', 'b']), ids(['x', 'b']))).toEqual([undefined, 2])
  })
})

describe('distinctById', () => {
  it('keeps the first row of each track, so counts and bulk actions see a track once', () => {
    expect(distinctById(['a', 'c', 'c', 'd'].map((id) => ({ id }))).map((r) => r.id)).toEqual([
      'a',
      'c',
      'd',
    ])
  })

  it('hands back the same list when nothing repeats, so the memoized rows keep their input', () => {
    const rows = ['a', 'b'].map((id) => ({ id }))
    expect(distinctById(rows)).toBe(rows)
  })
})

describe('blocksWith with a track in two blocks', () => {
  it('reads the break before the second row of a repeated track', () => {
    const rows = ['a', 'c', 'c', 'd'].map((id) => ({ id }))
    const breaks = new Map([['c~1', ['s1']]])
    expect(blocksWith(rows, breaks, (r) => r.id === 'd').rows.map((r) => r.id)).toEqual(['c', 'd'])
  })

  it('keys the kept breaks by the rows left, so a search never splits a block', () => {
    const rows = ['a', 'c', 'c', 'd', 'e', 'c'].map((id) => ({ id }))
    const breaks = new Map([
      ['c~1', ['s1']],
      ['e', ['s2']],
    ])
    const found = blocksWith(rows, breaks, (r) => r.id === 'd' || r.id === 'e')
    expect(found.rows.map((r) => r.id)).toEqual(['c', 'd', 'e', 'c'])
    expect([...found.separatorBefore]).toEqual([['e', ['s2']]])
  })
})

describe('blocksWith', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  const breaks = new Map([['c', ['s1']]])

  it('shows a searched track with every partner in its block, since the block is the match', () => {
    expect(blocksWith(rows, breaks, (r) => r.id === 'd').rows.map((r) => r.id)).toEqual(['c', 'd'])
  })

  it('shows nothing when no track is found, so an empty search result stays empty', () => {
    expect(blocksWith(rows, breaks, () => false).rows).toEqual([])
  })
})

describe('blocksWith with rows a filter hides', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
  const breaks = new Map([
    ['c', ['s1']],
    ['e', ['s2']],
  ])
  const shown = (r: { id: string }) => r.id !== 'c'

  it('moves the break of a hidden head onto the first row its block still shows, so two blocks never read as one', () => {
    const found = blocksWith(rows, breaks, () => true, shown)
    expect(found.rows.map((r) => r.id)).toEqual(['a', 'b', 'd', 'e', 'f'])
    expect([...found.separatorBefore]).toEqual([
      ['d', ['s1']],
      ['e', ['s2']],
    ])
  })

  it('drops a block whose rows the filter hides all, with its break', () => {
    const found = blocksWith(
      rows,
      breaks,
      () => true,
      (r) => r.id !== 'c' && r.id !== 'd',
    )
    expect(found.rows.map((r) => r.id)).toEqual(['a', 'b', 'e', 'f'])
    expect([...found.separatorBefore]).toEqual([['e', ['s2']]])
  })

  it('searches only the rows the filter shows, and draws no break before the first block found', () => {
    const found = blocksWith(rows, breaks, (r) => r.id === 'd' || r.id === 'e', shown)
    expect(found.rows.map((r) => r.id)).toEqual(['d', 'e', 'f'])
    expect([...found.separatorBefore]).toEqual([['e', ['s2']]])
    expect(blocksWith(rows, breaks, (r) => r.id === 'c', shown).rows).toEqual([])
  })

  it('keys the moved break by the rows left when a repeated track is hidden', () => {
    const repeated = ['a', 'c', 'c', 'd', 'e', 'c'].map((id) => ({ id }))
    const found = blocksWith(
      repeated,
      new Map([
        ['c~1', ['s1']],
        ['e', ['s2']],
      ]),
      () => true,
      (r) => r.id !== 'c',
    )
    expect(found.rows.map((r) => r.id)).toEqual(['a', 'd', 'e'])
    expect([...found.separatorBefore]).toEqual([
      ['d', ['s1']],
      ['e', ['s2']],
    ])
  })
})

describe('listScopeFlags', () => {
  const files = [A, B]
  const scope = (over: Partial<ReturnType<typeof playlistView>> = {}) => ({
    ...playlistView([A, B, C], [entry('/m/C.wav'), entry('/m/A.wav')]),
    ...over,
  })
  const playlist = { id: 'p1', name: 'Set', folders: [] }
  const ctx = (over: Partial<ListScopeContext> = {}): ListScopeContext => ({
    playlistScope: null,
    pickedSort: 'import',
    browser: { source: null, playlist: null, entries: undefined },
    checkedPlaylist: null,
    scopeRows: files,
    filesView: files,
    tracks: [A, B, C],
    showListPositions: true,
    autoAnalyze: false,
    analyzeAsked: false,
    filterSelection: EMPTY_FILTER,
    librarySource: null,
    sourceProgram: null,
    selectedTracks: [],
    ...over,
  })

  // Sorting by date added needs dates to sort by: a list without them (Files, or a
  // playlist whose program keeps none) would sort into noise, so it falls back to import.
  it('sorts by date added only where the playlist carries the dates', () => {
    expect(listScopeFlags(ctx({ pickedSort: 'dateAdded' })).sortBy).toBe('import')
    const dated = scope({ addedOf: new Map([['a', 1]]) })
    const flags = listScopeFlags(ctx({ pickedSort: 'dateAdded', playlistScope: dated }))
    expect(flags.sortBy).toBe('dateAdded')
    expect(flags.hasAddedDates).toBe(true)
    expect(listScopeFlags(ctx({ pickedSort: 'name' })).sortBy).toBe('name')
  })

  // The sidebar counts what the open place holds: the whole collection of a library, the
  // working list in Files.
  it('counts the library collection in a library and the working list in Files', () => {
    expect(listScopeFlags(ctx()).listedCount).toBe(2)
    expect(
      listScopeFlags(ctx({ browser: { source: 'rekordbox', playlist: null, entries: undefined } }))
        .listedCount,
    ).toBe(3)
  })

  // "The files are away" is only said once the playlist was checked and it lists real rows
  // none of which loaded; while it loads, or for a playlist of separators only, it is empty
  // for another reason.
  it('reports the files away only for a checked playlist with real rows and none shown', () => {
    const open = { source: 'rekordbox' as const, playlist, entries: [entry('/m/X.wav')] }
    const away = ctx({ browser: open, checkedPlaylist: 'rekordbox:p1', scopeRows: [] })
    expect(listScopeFlags(away).filesAway).toBe(true)
    expect(listScopeFlags({ ...away, checkedPlaylist: null }).filesAway).toBe(false)
    expect(listScopeFlags({ ...away, scopeRows: [A] }).filesAway).toBe(false)
    expect(
      listScopeFlags({ ...away, browser: { ...open, entries: [entry(null, true)] } }).filesAway,
    ).toBe(false)
  })

  // The view key follows the playlist once its rows are applied, so the order held for the
  // selected row does not carry over while the next playlist's entries load.
  it('keys the open playlist only once its rows are applied', () => {
    const open = { source: 'rekordbox' as const, playlist, entries: [] }
    expect(listScopeFlags(ctx({ browser: open })).openPlaylistId).toBe('')
    expect(listScopeFlags(ctx({ browser: open, playlistScope: scope() })).openPlaylistId).toBe('p1')
  })

  // listPositions is memoized on numberedTracks: handing back the playlist's or the
  // working list's own array keeps it from recounting on every render.
  it('numbers the import order with the very array the list is drawn from', () => {
    const applied = scope()
    expect(listScopeFlags(ctx({ playlistScope: applied })).numberedTracks).toBe(applied.tracks)
    expect(listScopeFlags(ctx()).numberedTracks).toBe(files)
    const library = { source: 'rekordbox' as const, playlist: null, entries: undefined }
    expect(listScopeFlags(ctx({ browser: library })).numberedTracks).toBeUndefined()
  })

  // Numbers mean the place in the import order: hidden when turned off, when another sort
  // is on, and in Matching and To review, whose rows are pairs and leftovers, not an order.
  it('drops the numbers when they would not be the import order', () => {
    expect(listScopeFlags(ctx({ showListPositions: false })).numberedTracks).toBeUndefined()
    expect(listScopeFlags(ctx({ pickedSort: 'name' })).numberedTracks).toBeUndefined()
    for (const id of [MATCHING_ID, TO_REVIEW_ID]) {
      const open = { source: 'rekordbox' as const, playlist: { ...playlist, id }, entries: [] }
      expect(
        listScopeFlags(ctx({ browser: open, playlistScope: scope() })).numberedTracks,
      ).toBeUndefined()
    }
  })

  // Grids and the library comparison run with the analysis: by themselves with auto-analyze,
  // once Analyze is pressed, or while their own filter asks for them.
  it('measures grids and the library copy with the analysis or their own filter', () => {
    const idle = listScopeFlags(ctx())
    expect([idle.measuringGrid, idle.measuringLibrary]).toEqual([false, false])
    for (const over of [{ autoAnalyze: true }, { analyzeAsked: true }]) {
      const flags = listScopeFlags(ctx(over))
      expect([flags.measuringGrid, flags.measuringLibrary]).toEqual([true, true])
    }
    const grid = listScopeFlags(ctx({ filterSelection: { ...EMPTY_FILTER, attention: 'badGrid' } }))
    expect([grid.measuringGrid, grid.measuringLibrary]).toEqual([true, false])
    const library = listScopeFlags(
      ctx({ filterSelection: { ...EMPTY_FILTER, library: 'betterThanLibrary' } }),
    )
    expect([library.measuringGrid, library.measuringLibrary]).toEqual([false, true])
  })

  // The comparison is against the Apple Music copy of a file Surco converts, so it exists
  // only in Files with Apple Music as the destination library.
  it('compares with the library copy only in Files sending to Apple Music', () => {
    expect(listScopeFlags(ctx({ librarySource: 'appleMusic' })).comparesLibraryCopy).toBe(true)
    expect(listScopeFlags(ctx({ librarySource: 'engineDj' })).comparesLibraryCopy).toBe(false)
    const library = { source: 'rekordbox' as const, playlist: null, entries: undefined }
    expect(
      listScopeFlags(ctx({ librarySource: 'appleMusic', browser: library })).comparesLibraryCopy,
    ).toBe(false)
  })

  // Cues belong to a DJ program's playlist once its rows are on screen; the batch cue
  // strip needs more than one picked row on top of that.
  it('opens cues on an applied DJ playlist and the batch strip for several rows', () => {
    const open = { source: 'rekordbox' as const, playlist, entries: [] }
    const applied = ctx({ browser: open, playlistScope: scope(), sourceProgram: 'rekordbox' })
    expect(listScopeFlags(applied).cuesOpen).toBe(true)
    expect(listScopeFlags(applied).batchCuesShown).toBe(false)
    expect(listScopeFlags({ ...applied, selectedTracks: [A, C] }).batchCuesShown).toBe(true)
    expect(listScopeFlags({ ...applied, sourceProgram: null }).cuesOpen).toBe(false)
    expect(listScopeFlags({ ...applied, playlistScope: null }).cuesOpen).toBe(false)
    expect(
      listScopeFlags({ ...applied, browser: { ...open, playlist: null }, selectedTracks: [A, C] })
        .batchCuesShown,
    ).toBe(false)
  })
})

describe('toolbarScopeFlags', () => {
  const settings = (over: Partial<Settings>): Settings =>
    ({ autoMatch: true, searchProviders: ['discogs'], discogsToken: '', ...over }) as Settings
  const ctx = (over: Partial<ToolbarScopeContext> = {}): ToolbarScopeContext => ({
    source: null,
    visibleTracks: [A, B],
    selectedTracks: [B],
    scopeTracks: [A, B],
    settings: settings({}),
    eligibleCount: 2,
    batching: false,
    ...over,
  })

  // autoMatchable is memoized on these tracks: the toolbar must get the list's own array,
  // the visible rows in Files and only the picked ones in a library.
  it('matches over the visible rows in Files and the picked rows in a library', () => {
    const files = ctx()
    expect(toolbarScopeFlags(files).autoMatchButtonTracks).toBe(files.visibleTracks)
    const library = ctx({ source: 'traktor' })
    expect(toolbarScopeFlags(library).autoMatchButtonTracks).toBe(library.selectedTracks)
  })

  // With auto-match on and no way to run it, the button becomes the "add a token" fix, but
  // only when there are tracks to match.
  it('asks for a token only when auto-match is on, cannot run and has tracks', () => {
    expect(toolbarScopeFlags(ctx()).needsToken).toBe(true)
    expect(toolbarScopeFlags(ctx({ scopeTracks: [] })).needsToken).toBe(false)
    expect(toolbarScopeFlags(ctx({ settings: settings({ autoMatch: false }) })).needsToken).toBe(
      false,
    )
    expect(toolbarScopeFlags(ctx({ settings: settings({ discogsToken: 'tok' }) })).needsToken).toBe(
      false,
    )
    expect(toolbarScopeFlags(ctx({ settings: null })).needsToken).toBe(false)
  })

  // The missing token is Discogs's: Beatport without an account can't run either, but no
  // token would fix that, so nothing is missing while Discogs is not a source.
  it('reports the token missing only while Discogs is a source and has no token', () => {
    expect(toolbarScopeFlags(ctx({ settings: settings({ autoMatch: false }) })).tokenMissing).toBe(
      true,
    )
    expect(
      toolbarScopeFlags(ctx({ settings: settings({ searchProviders: ['beatport'] }) }))
        .tokenMissing,
    ).toBe(false)
    expect(toolbarScopeFlags(ctx({ settings: null })).tokenMissing).toBe(false)
  })

  // Convert all needs something ready and no conversion already writing the files.
  it('converts all only with ready tracks and no batch running', () => {
    expect(toolbarScopeFlags(ctx()).canProcessAll).toBe(true)
    expect(toolbarScopeFlags(ctx({ eligibleCount: 0 })).canProcessAll).toBe(false)
    expect(toolbarScopeFlags(ctx({ batching: true })).canProcessAll).toBe(false)
  })
})
