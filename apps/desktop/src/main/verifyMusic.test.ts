import { homedir } from 'node:os'
import { describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { MusicEntryFacts, readMusicEntryFacts, runOsascript } from './applemusic'
import {
  checkAppleMusic,
  type MusicExpect,
  type MusicReaders,
  musicEntriesForFile,
} from './verifyMusic'

const FILE = '/Volumes/Music/Media/Artist/Title.wav'

const facts = (over: Partial<MusicEntryFacts> = {}): MusicEntryFacts => ({
  location: FILE,
  name: 'Title',
  artist: 'Artist',
  album: 'Album',
  artworks: 1,
  playlists: ['24', 'All'],
  ...over,
})

const expectFor = (over: Partial<MusicExpect> = {}): MusicExpect => ({
  pid: 'NEW',
  file: FILE,
  ext: '.wav',
  meta: { title: 'Title', artist: 'Artist', album: 'Album' },
  coverSet: true,
  ...over,
})

function readers(
  answers: (MusicEntryFacts | 'missing' | Error)[],
  over: Partial<Omit<MusicReaders, 'entry'>> = {},
): MusicReaders & { entry: Mock<typeof readMusicEntryFacts> } {
  const queue = [...answers]
  const entry = vi.fn<typeof readMusicEntryFacts>(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next instanceof Error) throw next
    return next as MusicEntryFacts | 'missing'
  })
  return {
    entry,
    entriesForFile: vi.fn<MusicReaders['entriesForFile']>(async () => ['NEW']),
    realPath: (p) => p,
    wait: vi.fn<MusicReaders['wait']>(async () => {}),
    ...over,
  }
}

describe('checkAppleMusic', () => {
  // The success line may only say "added to Apple Music" when the entry really plays the
  // file Surco wrote, once, in the playlists it should be in.
  it('an entry on the WAV with one reference is ok with musicOne and its playlists', async () => {
    const r = readers([facts()])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toEqual({
      place: 'appleMusic',
      state: 'ok',
      detail: { key: 'musicOne', params: { playlists: ['24', 'All'] } },
    })
  })

  it('an entry in no playlist is ok with its own key', async () => {
    const r = readers([facts({ playlists: [] })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toEqual({
      place: 'appleMusic',
      state: 'ok',
      detail: { key: 'musicOneNoPlaylists' },
    })
  })

  // 30/10: the AIFF→WAV run said "added" while Music still played the AIFF.
  it('an entry still on the AIFF is musicWrongFile with format AIFF', async () => {
    const r = readers([facts({ location: '/Volumes/Music/Media/Artist/Title.aiff' })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicWrongFile', params: { format: 'AIFF' } },
    })
  })

  it('an entry on another file of the same format is musicOtherFile', async () => {
    const r = readers([facts({ location: '/Volumes/Music/Media/Other/Title.wav' })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicOtherFile' },
    })
  })

  // Music answers an add that matches an existing entry with that entry: a replace that
  // leaves the old one standing has two copies of the track.
  it('the old entry still there after a replace is musicDuplicate', async () => {
    const r = readers([facts({ oldExists: true })])
    const e = expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: [] } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicDuplicate', params: { count: 2 } },
    })
  })

  it('two entries on the same file is musicDuplicate count 2', async () => {
    const r = readers([facts()], {
      entriesForFile: vi.fn<MusicReaders['entriesForFile']>(async () => ['NEW', 'OTHER']),
    })

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicDuplicate', params: { count: 2 } },
    })
  })

  // A lookup that does not even see the entry just read cannot vouch for how many there are.
  it('a file lookup that misses the entry itself is unreadable', async () => {
    const r = readers([facts()], {
      entriesForFile: vi.fn<MusicReaders['entriesForFile']>(async () => []),
    })

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'unreadable',
    })
  })

  it('looks the file up by the name Music shows and the title written', async () => {
    const r = readers([facts({ name: 'Title.wav' })])

    await checkAppleMusic(expectFor({ meta: { title: '', artist: 'Artist', album: 'Album' } }), r)
    await checkAppleMusic(
      expectFor({ meta: { title: 'Title', artist: 'Artist', album: 'Album' } }),
      r,
    )

    expect(vi.mocked(r.entriesForFile).mock.calls).toEqual([
      [FILE, ['Title.wav']],
      [FILE, ['Title.wav', 'Title']],
    ])
  })

  // ~/Music/Music is a link to the volume the library also references directly: the same
  // file under two spellings must not read as the wrong file.
  it('a location through ~/Music/Music and the volume path count as the same file', async () => {
    const link = `${homedir()}/Music/Music`
    const realPath = (p: string) =>
      p.startsWith(link) ? `/Volumes/Music${p.slice(link.length)}` : p
    const r = readers([facts({ location: `${link}/Media/Artist/Title.wav` })], { realPath })

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({ state: 'ok' })
  })

  // macOS hands back decomposed accents; Music keeps whatever it was given.
  it('an accented path in NFD matches the same path written in NFC', async () => {
    const nfc = '/Volumes/Music/Media/Café/Título.wav'.normalize('NFC')
    const r = readers([facts({ location: nfc.normalize('NFD') })])

    await expect(checkAppleMusic(expectFor({ file: nfc }), r)).resolves.toMatchObject({
      state: 'ok',
    })
  })

  // 30/10: the replace deleted the only copy and the track left Music.
  it('a missing entry is musicMissing', async () => {
    const r = readers(['missing'])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicMissing' },
    })
  })

  // Music imports asynchronously: right after the add the location may still be empty.
  it('an empty location is retried 3 times then is a mismatch', async () => {
    const r = readers([facts({ location: '' })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicNoFile' },
    })
    expect(r.entry).toHaveBeenCalledTimes(4)
    expect(vi.mocked(r.wait).mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000])
  })

  it('an empty location that fills on the third read is ok', async () => {
    const r = readers([facts({ location: '' }), facts({ location: '' }), facts()])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({ state: 'ok' })
    expect(vi.mocked(r.wait).mock.calls.map(([ms]) => ms)).toEqual([1000, 2000])
  })

  // A location Music would not hand over says nothing about the file: not ok, not wrong.
  it('a location Music could not read is retried then unreadable', async () => {
    const r = readers([facts({ location: null })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'unreadable',
      detail: { key: 'musicUnreadable' },
    })
    expect(vi.mocked(r.wait).mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000])
  })

  it('a location Music could not read at first that it hands over later is ok', async () => {
    const r = readers([facts({ location: null }), facts()])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({ state: 'ok' })
  })

  it('a name that differs from the title written is musicTagDiffers', async () => {
    const r = readers([facts({ artist: 'Someone Else' })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicTagDiffers', params: { field: 'artist' } },
    })
  })

  it('tags compare with accents composed and spaces trimmed', async () => {
    const r = readers([facts({ name: ' Café '.normalize('NFD') })])
    const e = expectFor({ meta: { title: 'Café', artist: 'Artist', album: 'Album' } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({ state: 'ok' })
  })

  it('a playlist the old entry had and the new one lacks is musicPlaylistLost', async () => {
    const r = readers([facts({ playlists: ['All'], oldExists: false })])
    const e = expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: ['24', 'All'] } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicPlaylistLost', params: { playlist: '24' } },
    })
  })

  // readMusicEntryFacts answers no playlists unless asked: a forgotten flag would make
  // every carried playlist look lost, and asking on a plain add walks every playlist.
  it('asks Music for playlists only when a replace carried some', async () => {
    const r = readers([facts({ oldExists: false })])

    await checkAppleMusic(expectFor(), r)
    await checkAppleMusic(expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: ['24'] } }), r)

    expect(r.entry.mock.calls[0]).toEqual(['NEW', undefined, { withPlaylists: false }])
    expect(r.entry.mock.calls[1]).toEqual(['NEW', 'OLD', { withPlaylists: true }])
  })

  // The replace already reported keeping the old entry (oldMusicCopyKept): it is there by
  // design and is not a duplicate of this check's making, but the carry still has to hold.
  it('an old entry kept on purpose is not a duplicate', async () => {
    const r = readers([facts({ oldExists: true })])
    const e = expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: ['24'], oldKept: true } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({ state: 'ok' })
  })

  it('an old entry kept on purpose still needs its playlists carried', async () => {
    const r = readers([facts({ oldExists: true, playlists: ['All'] })])
    const e = expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: ['24'], oldKept: true } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicPlaylistLost', params: { playlist: '24' } },
    })
  })

  // The playlists could not be read before the add: their carry cannot be vouched for.
  it('a replace whose old playlists were not read is unreadable', async () => {
    const r = readers([facts({ oldExists: false })])
    const e = expectFor({ replaced: { oldPid: 'OLD', playlistsBefore: null } })

    await expect(checkAppleMusic(e, r)).resolves.toMatchObject({ state: 'unreadable' })
  })

  it('no artwork when a cover was set is musicNoArtwork', async () => {
    const r = readers([facts({ artworks: 0 })])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'mismatch',
      detail: { key: 'musicNoArtwork' },
    })
  })

  it('osascript failing is unreadable', async () => {
    const r = readers([new Error('Apple Music did not answer in time')])

    await expect(checkAppleMusic(expectFor(), r)).resolves.toEqual({
      place: 'appleMusic',
      state: 'unreadable',
      detail: { key: 'musicUnreadable' },
    })
  })

  it('a file lookup that fails is unreadable', async () => {
    const r = readers([facts()], {
      entriesForFile: vi.fn<MusicReaders['entriesForFile']>(async () => {
        throw new Error('Music could not say which entries play the file')
      }),
    })

    await expect(checkAppleMusic(expectFor(), r)).resolves.toMatchObject({
      state: 'unreadable',
    })
  })
})

describe('musicEntriesForFile', () => {
  const RS = '\u001e'
  const FS = '\u001f'
  const SELF = 'AAAAAAAAAAAAAAAA'
  const TWIN = 'BBBBBBBBBBBBBBBB'
  const home = '/Users/dj/Music/Music'
  const realPath = (p: string) => (p.startsWith(home) ? `/Volumes/Music${p.slice(home.length)}` : p)

  function music(located: [string, string][]): Mock<typeof runOsascript> {
    const names = located.map(([pid]) => [pid, 'Artist', 'Title', ''].join(FS)).join(RS)
    const locations = located.map(([pid, path]) => [pid, path].join(FS)).join(RS)
    return vi
      .fn<typeof runOsascript>()
      .mockResolvedValueOnce(names)
      .mockResolvedValueOnce(locations)
  }

  const lookup = (run: Mock<typeof runOsascript>) =>
    musicEntriesForFile({ run, realPath, homeMusicDir: home })

  // The spec counts entries by where the path really lands, not by its spelling: the
  // library references the volume both directly and through the home link.
  it('counts a twin stored through the ~/Music/Music link', async () => {
    const run = music([
      [SELF, '/Volumes/Music/Media/Title.wav'],
      [TWIN, `${home}/Media/Title.wav`],
    ])

    await expect(lookup(run)('/Volumes/Music/Media/Title.wav', ['Title'])).resolves.toEqual([
      SELF,
      TWIN,
    ])
  })

  it('counts a twin stored with decomposed accents', async () => {
    const path = '/Volumes/Music/Media/Café.wav'.normalize('NFC')
    const run = music([
      [SELF, path],
      [TWIN, path.normalize('NFD')],
    ])

    await expect(lookup(run)(path, ['Title'])).resolves.toEqual([SELF, TWIN])
  })

  // macOS volumes are case-insensitive: the entry itself under another case is one entry.
  it('finds the entry itself stored in another case and nothing more', async () => {
    const run = music([
      [SELF, '/Volumes/Music/Media/TITLE.wav'],
      [TWIN, '/Volumes/Music/Media/Other.wav'],
    ])

    await expect(lookup(run)('/Volumes/Music/Media/Title.wav', ['Title'])).resolves.toEqual([SELF])
  })

  it('rejects when Music could not say', async () => {
    const run = vi.fn<typeof runOsascript>().mockRejectedValue(new Error('-1712'))

    await expect(lookup(run)('/Volumes/Music/Media/Title.wav', ['Title'])).rejects.toThrow()
  })
})
