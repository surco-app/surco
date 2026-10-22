import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import {
  abandonRekordboxBatch,
  attachRekordboxPlaylists,
  beginRekordboxBatch,
  endRekordboxBatch,
  recordRekordboxRepoint,
  redirectRekordboxRepoint,
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
      source.match(/on\('process:batch-begin', \(\) => \{([\s\S]*?)\n  \}\)/)?.[1] ?? ''
    expect(handler).toMatch(
      /if \(beginRekordboxBatch\(\)\) \{\s*rekordboxSessionBackup\.reset\(\)\s*engineSessionBackup\.reset\(\)/,
    )
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
})
