import { beforeEach, describe, expect, it } from 'vitest'
import {
  abandonRekordboxBatch,
  beginRekordboxBatch,
  endRekordboxBatch,
  recordRekordboxRepoint,
} from './rekordboxBatch'

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
