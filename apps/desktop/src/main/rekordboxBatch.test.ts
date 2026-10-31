import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import {
  abandonRekordboxBatch,
  attachLibraryPlaylists,
  attachRekordboxPlaylists,
  beginRekordboxBatch,
  endRekordboxBatch,
  recordedRekordboxRepoint,
  recordRekordboxRepoint,
  redirectRekordboxRepoint,
  rekordboxBatchOpen,
} from './rekordboxBatch'
import { rekordboxMetaFrom } from './rekordboxMetadata'

const a = { from: '/m/one.mp3', to: '/m/one.wav' }
const b = { from: '/m/two.mp3', to: '/m/two.wav' }

beforeEach(() => {
  abandonRekordboxBatch()
})

describe('rekordbox batch', () => {
  it('hands back what the batch recorded', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    recordRekordboxRepoint(b)
    expect(endRekordboxBatch()).toEqual([a, b])
  })

  // The check after the batch hands a library still on the old file this same move again,
  // with the cue shift it carried, found by where the file landed.
  it('hands back the repoint recorded for a converted file, after its redirect', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ ...a, audio: { cueShiftMs: 25 } })
    redirectRekordboxRepoint(a.to, '/Media/one.wav')
    expect(recordedRekordboxRepoint('/Media/one.wav')).toMatchObject({ audio: { cueShiftMs: 25 } })
    expect(recordedRekordboxRepoint(a.to)).toBeUndefined()
  })

  // Two conversions landing on one file: the check of the later one is handed its own shift.
  it('finds the last repoint recorded for a converted file', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ ...a, audio: { cueShiftMs: 25 } })
    recordRekordboxRepoint({ from: '/m/one.flac', to: a.to, audio: { cueShiftMs: 10 } })
    expect(recordedRekordboxRepoint(a.to)).toMatchObject({ audio: { cueShiftMs: 10 } })
  })

  // A tags-only update keeps the path, but the entry still has to learn the new title.
  it('keeps a same-path update that carries tags', () => {
    const update = {
      from: '/m/one.wav',
      to: '/m/one.wav',
      meta: rekordboxMetaFrom(emptyMetadata()),
    }
    beginRekordboxBatch()
    recordRekordboxRepoint(update)
    expect(endRekordboxBatch()).toEqual([update])
  })

  it('starts each batch empty', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    endRekordboxBatch()

    beginRekordboxBatch()
    expect(endRekordboxBatch()).toEqual([])
  })

  // Converting one track (⌘⏎ in the editor) opens its own batch, and nothing stops that
  // happening while a whole-library run is still going. If the inner begin reset the
  // pool, that single convert would wipe everything the outer batch had recorded; if the
  // inner end returned it, the collection would be written halfway through the run.
  // Traktor's accumulator learned this the same way.
  it('keeps one pool when a convert fires inside a running batch', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)

    beginRekordboxBatch()
    recordRekordboxRepoint(b)
    expect(endRekordboxBatch()).toEqual([])

    expect(endRekordboxBatch()).toEqual([a, b])
  })

  // The renderer can disappear between a begin and its end — a reload, or the crash and
  // reload this app has seen in the wild. Without a way back, the depth would stay above
  // zero and no later batch would ever flush again: the collection would quietly stop
  // being updated until the app restarted.
  it('recovers when a batch is abandoned mid-flight', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    abandonRekordboxBatch()

    beginRekordboxBatch()
    recordRekordboxRepoint(b)
    expect(endRekordboxBatch()).toEqual([b])
  })

  // A conversion that lands on the same path it started from changes nothing rekordbox
  // needs to know, and recording it would make the flush open and back up the collection
  // for no reason.
  it('ignores a conversion that does not move the file', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.wav', to: '/m/one.wav' })
    expect(endRekordboxBatch()).toEqual([])
  })

  // Converting the same track twice in one run (a retry, or an edit then a convert)
  // should leave the collection pointing at the last file produced, not at the first.
  it('keeps only the last repoint for a track converted twice', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/m/one.wav' })
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/m/one.aiff' })
    expect(endRekordboxBatch()).toEqual([{ from: '/m/one.mp3', to: '/m/one.aiff' }])
  })

  // An MP3 re-encoded on its own path keeps the path, but its audio moved under the cues
  // (measured 24/10: 26 ms in the user's rekordbox), so the entry still needs the write.
  it('keeps a re-encode on the same path even without tags', () => {
    const reencode = { from: '/m/one.mp3', to: '/m/one.mp3', audio: { cueShiftMs: -25 } }
    beginRekordboxBatch()
    recordRekordboxRepoint(reencode)
    expect(endRekordboxBatch()).toEqual([reencode])
  })

  // The collection is written once at the end of the run, so its cues still sit where the
  // DJ put them on the ORIGINAL file. A second re-encode on the same path started from the
  // first one's output, so the cues have to travel both distances, not just the last.
  it('adds up the moves of a file re-encoded twice on its own path', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/m/one.mp3', audio: { cueShiftMs: -25 } })
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/m/one.mp3', audio: { cueShiftMs: -500 } })
    expect(endRekordboxBatch()).toEqual([
      { from: '/m/one.mp3', to: '/m/one.mp3', audio: { cueShiftMs: -525 } },
    ])
  })

  // Engine's cues also still sit on the original: a trim in place followed by a trimmed
  // conversion elsewhere moves them by both cuts, counted at the last file's rate.
  it('adds up Engine’s cuts the same way, at the last conversion’s rate', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({
      from: '/m/one.wav',
      to: '/m/one.wav',
      audio: { cueShiftMs: -1000 },
      engineShift: { trimmedMs: 1000 },
    })
    recordRekordboxRepoint({
      from: '/m/one.wav',
      to: '/out/one.aiff',
      audio: { cueShiftMs: -900 },
      engineShift: { trimmedMs: 900, sampleRateHz: 48000 },
    })
    expect(endRekordboxBatch()).toEqual([
      {
        from: '/m/one.wav',
        to: '/out/one.aiff',
        audio: { cueShiftMs: -1900 },
        engineShift: { trimmedMs: 1900, sampleRateHz: 48000 },
      },
    ])
  })

  // Engine still records the size the file had before the first rewrite, so that is the size
  // that says the stacked shift is owed; the second rewrite's own source size is one the row
  // never had.
  it('keeps the size from before the first rewrite when a file is rewritten in place twice', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({
      from: '/m/one.mp3',
      to: '/m/one.mp3',
      audio: { cueShiftMs: -1000 },
      engineShift: { trimmedMs: 1000 },
      fromBytes: 100,
    })
    recordRekordboxRepoint({
      from: '/m/one.mp3',
      to: '/m/one.mp3',
      audio: { cueShiftMs: -900 },
      engineShift: { trimmedMs: 900 },
      fromBytes: 90,
    })
    expect(endRekordboxBatch()).toEqual([
      {
        from: '/m/one.mp3',
        to: '/m/one.mp3',
        audio: { cueShiftMs: -1900 },
        engineShift: { trimmedMs: 1900 },
        fromBytes: 100,
      },
    ])
  })

  // Converting into another folder leaves the original in place, and a second conversion
  // reads that original again: its move already counts from the cues' file.
  it('keeps only the last move when both conversions started from the original', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/out/one.aiff', audio: { cueShiftMs: -51 } })
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/out/one.aiff', audio: { cueShiftMs: -51 } })
    expect(endRekordboxBatch()).toEqual([
      { from: '/m/one.mp3', to: '/out/one.aiff', audio: { cueShiftMs: -51 } },
    ])
  })
})

// Measured 15/09 from the user's own log, after three runs that reported only "1 skipped":
//   rekordbox repoint: 0 written, skipped output-missing (/var/folders/…/surco-4AJwDM/….aiff)
// With Apple Music as the destination the conversion writes to a private temp dir and
// Music copies the file into its Media folder, so the path recorded at conversion time is
// gone by the time the flush runs and the repoint is refused — correctly, since pointing
// the collection at a dead path just trades one "!" for another. The collection has to be
// told where the file actually ended up.
describe('rekordbox batch redirecting to where the file really landed', () => {
  it('rewrites the destination of a recorded repoint', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/tmp/surco-x/one.aiff' })

    redirectRekordboxRepoint('/tmp/surco-x/one.aiff', '/Media/one.aiff')

    expect(endRekordboxBatch()).toEqual([{ from: '/m/one.mp3', to: '/Media/one.aiff' }])
  })

  // The redirect is keyed by the path the entry currently points at, so a run converting
  // several tracks moves only the one whose file was relocated.
  it('leaves the other tracks in the batch alone', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/tmp/surco-x/one.aiff' })
    recordRekordboxRepoint(b)

    redirectRekordboxRepoint('/tmp/surco-x/one.aiff', '/Media/one.aiff')

    expect(endRekordboxBatch()).toEqual([{ from: '/m/one.mp3', to: '/Media/one.aiff' }, b])
  })

  // A redirect naming a path the batch never recorded must not invent an entry: that
  // would repoint a track on the strength of a stale or unrelated path.
  it('records nothing when no entry points at that path', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(b)

    redirectRekordboxRepoint('/tmp/surco-x/one.aiff', '/Media/one.aiff')

    expect(endRekordboxBatch()).toEqual([b])
  })

  // Landing back on the source is the "nothing moved" case recordRekordboxRepoint already
  // refuses; a redirect must reach the same state rather than leave a self-pointing entry.
  it('drops the entry when the file landed back on the path it came from', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/tmp/surco-x/one.aiff' })

    redirectRekordboxRepoint('/tmp/surco-x/one.aiff', '/m/one.mp3')

    expect(endRekordboxBatch()).toEqual([])
  })

  // An in-place tags update that went through Apple Music lands back on its own path, and
  // the entry still has the new details to learn.
  it('keeps an entry that landed back on its path when it carries tags', () => {
    const meta = rekordboxMetaFrom(emptyMetadata())
    beginRekordboxBatch()
    recordRekordboxRepoint({ from: '/m/one.mp3', to: '/tmp/surco-x/one.mp3', meta })

    redirectRekordboxRepoint('/tmp/surco-x/one.mp3', '/m/one.mp3')

    expect(endRekordboxBatch()).toEqual([{ from: '/m/one.mp3', to: '/m/one.mp3', meta }])
  })

  it('keeps an entry that landed back on its path when its audio was re-encoded', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint({
      from: '/m/one.mp3',
      to: '/tmp/surco-x/one.mp3',
      audio: { cueShiftMs: -25 },
    })

    redirectRekordboxRepoint('/tmp/surco-x/one.mp3', '/m/one.mp3')

    expect(endRekordboxBatch()).toEqual([
      { from: '/m/one.mp3', to: '/m/one.mp3', audio: { cueShiftMs: -25 } },
    ])
  })
})

describe('playlists on a repoint', () => {
  it('attaches the wanted playlists to the repoint of the file just written', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ id: '3000', name: 'Makina' }])
    expect(endRekordboxBatch()).toEqual([{ ...a, playlists: [{ id: '3000', name: 'Makina' }] }])
  })

  it('carries the membership the user edited against so the queue judges removals by it', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ id: '3000', name: 'Makina' }], ['3000'])
    expect(endRekordboxBatch()).toEqual([
      { ...a, playlists: [{ id: '3000', name: 'Makina' }], playlistsBase: ['3000'] },
    ])
  })

  it('carries the Traktor and Engine DJ choices beside the rekordbox one, each for its own queue', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ id: '3000', name: 'Makina' }])
    attachLibraryPlaylists('/m/one.wav', 'traktor', { wanted: [{ name: 'Friday' }], base: [] })
    attachLibraryPlaylists('/m/one.wav', 'engine', { wanted: [], base: ['7'] })
    attachLibraryPlaylists('/m/elsewhere.wav', 'engine', { wanted: [], base: [] })
    expect(endRekordboxBatch()).toEqual([
      {
        ...a,
        playlists: [{ id: '3000', name: 'Makina' }],
        traktorPlaylists: { wanted: [{ name: 'Friday' }], base: [] },
        enginePlaylists: { wanted: [], base: ['7'] },
      },
    ])
  })

  it('keeps the playlists when Apple Music moves the file and the repoint is redirected', () => {
    beginRekordboxBatch()
    recordRekordboxRepoint(a)
    attachRekordboxPlaylists('/m/one.wav', [{ name: 'Bolos' }])
    redirectRekordboxRepoint('/m/one.wav', '/Media/one.wav')
    expect(endRekordboxBatch()).toEqual([
      { ...a, to: '/Media/one.wav', playlists: [{ name: 'Bolos' }] },
    ])
  })
})

describe('a renderer reload', () => {
  it('abandons the rekordbox batch along with the NML one, so later batches still flush', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const handler = source.match(/on\('did-start-loading', \(\) => \{([^}]*)\}\)/)?.[1] ?? ''
    expect(handler).toContain('abandonNmlBatch()')
    expect(handler).toContain('abandonRekordboxBatch()')
  })

  it('starts a fresh pre-run copy only when the outermost batch opens', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const handler =
      source.match(/on\('process:batch-begin', \(\) => \{([\s\S]*?)\n {2}\}\)/)?.[1] ?? ''
    expect(handler).toMatch(/if \(beginRekordboxBatch\(\)\) \{\s*moments\.begin\('run'\)/)
  })

  it('keeps the conflict choice and cover memo of the run when a single convert starts mid-run', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    const handler =
      source.match(/on\('process:batch-begin', \(\) => \{([\s\S]*?)\n {2}\}\)/)?.[1] ?? ''
    const outer = handler.slice(handler.indexOf('if (beginRekordboxBatch())'))
    expect(handler.indexOf('if (beginRekordboxBatch())')).toBeGreaterThan(-1)
    expect(outer).toContain('stickyConflict.reset()')
    expect(outer).toContain('coverMemo = createCoverMemo(prepareProcessedCover)')
  })
})

describe('beginRekordboxBatch', () => {
  it('says whether it opened a new run, so a convert started mid-run is told apart', () => {
    abandonRekordboxBatch()
    expect(beginRekordboxBatch()).toBe(true)
    expect(beginRekordboxBatch()).toBe(false)
    endRekordboxBatch()
    endRekordboxBatch()
    expect(beginRekordboxBatch()).toBe(true)
    endRekordboxBatch()
  })

  it('reports a batch as open from its first begin until its last end', () => {
    abandonRekordboxBatch()
    expect(rekordboxBatchOpen()).toBe(false)
    beginRekordboxBatch()
    beginRekordboxBatch()
    endRekordboxBatch()
    expect(rekordboxBatchOpen()).toBe(true)
    endRekordboxBatch()
    expect(rekordboxBatchOpen()).toBe(false)
  })

  it('lets the close guard see an open batch', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8')
    expect(source).toContain('batchOpen: rekordboxBatchOpen,')
  })
})
