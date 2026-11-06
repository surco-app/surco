import { describe, expect, it } from 'vitest'
import { createAppStore } from './appStore'
import { parseSessionView, sessionViewOf, viewPatch } from './sessionView'
import { EMPTY_FILTER } from './triage'

describe('sessionView', () => {
  it('reads back the view it wrote, so a reopened crate shows the list as it was left', () => {
    const store = createAppStore()
    store.setState({
      search: 'dub',
      sortBy: 'bpm',
      sortDir: 'desc',
      libraryFilter: 'notInLibrary',
      formatFilter: 'FLAC',
      listenFilter: 'unplayed',
      selectionFilter: 'selected',
      starsFilter: 'stars4',
      playedPaths: new Set(['/music/a.wav']),
    })
    const view = JSON.parse(
      JSON.stringify(
        sessionViewOf(store.getState(), '/music/b.wav', { path: '/music/b.wav', time: 199.5 }, [
          '/music/a.wav',
          '/music/b.wav',
        ]),
      ),
    )
    expect(parseSessionView(view)).toEqual({
      selectedPath: '/music/b.wav',
      selectedPaths: ['/music/a.wav', '/music/b.wav'],
      playback: { path: '/music/b.wav', time: 199.5 },
      search: 'dub',
      sortBy: 'bpm',
      sortDir: 'desc',
      filters: {
        ...EMPTY_FILTER,
        library: 'notInLibrary',
        format: 'FLAC',
        listen: 'unplayed',
        selection: 'selected',
        stars: 'stars4',
      },
      played: ['/music/a.wav'],
    })
  })

  // An update installs on quit, so the next morning's launch can be a version that renamed
  // or retired a filter. A value it no longer knows would match no row and greet the user
  // with an empty list, so only that axis is let go and the rest of the view still applies.
  it('drops a filter or sort this version does not know, keeping the rest', () => {
    expect(
      parseSessionView({
        search: 'dub',
        sortBy: 'mood',
        sortDir: 'sideways',
        filters: { quality: 'retired', library: 'notInLibrary', tags: 42 },
        selectedPath: 7,
        selectedPaths: ['/music/a.wav', false],
        playback: { path: '/music/b.wav', time: -3 },
        played: ['/music/a.wav', 4, null],
      }),
    ).toEqual({
      selectedPath: null,
      selectedPaths: ['/music/a.wav'],
      playback: null,
      search: 'dub',
      sortBy: 'import',
      sortDir: 'asc',
      filters: { ...EMPTY_FILTER, library: 'notInLibrary' },
      played: ['/music/a.wav'],
    })
  })

  // The tracks already heard come back with the list, so a crate gone through over several
  // days picks up with the same ones still to hear.
  it('brings back which tracks were heard', () => {
    const view = parseSessionView({ played: ['/music/a.wav'] })
    expect(view && viewPatch(view).playedPaths).toEqual(new Set(['/music/a.wav']))
    expect(parseSessionView({ played: 'all' })?.played).toEqual([])
  })

  it('has no view to apply from a session saved before views were', () => {
    expect(parseSessionView(undefined)).toBeNull()
    expect(parseSessionView('list')).toBeNull()
  })
})
