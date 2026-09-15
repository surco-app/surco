import { describe, expect, it, vi } from 'vitest'
import type { RekordboxRepoint } from './rekordboxBatch'
import { flushRekordboxSync } from './rekordboxFlush'
import type { RepointResult } from './rekordboxLibrary'

const ONE: RekordboxRepoint = { from: '/m/one.mp3', to: '/m/one.wav' }
const TWO: RekordboxRepoint = { from: '/m/two.mp3', to: '/m/two.wav' }

function deps(over: Partial<Parameters<typeof flushRekordboxSync>[0]> = {}) {
  return {
    collectionPath: '/coll/master.db',
    endBatch: () => [ONE],
    repointTrack: vi.fn(async (): Promise<RepointResult> => ({ written: true, id: '1' })),
    ...over,
  }
}

describe('flushRekordboxSync', () => {
  it('repoints every track the batch recorded', async () => {
    const d = deps({ endBatch: () => [ONE, TWO] })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ written: 2, skipped: [] })
  })

  // Nothing recorded is the normal end of a run where no converted track was in the
  // collection, and it must not open or back up anything.
  it('does nothing when the batch is empty', async () => {
    const d = deps({ endBatch: () => [] })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).not.toHaveBeenCalled()
    expect(result).toEqual({ written: 0, skipped: [] })
  })

  // No collection means the user does not run rekordbox, or pointed the setting at
  // nothing. The feature is simply off, not broken.
  it('does nothing when there is no collection', async () => {
    const d = deps({ collectionPath: '' })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).not.toHaveBeenCalled()
    expect(result).toEqual({ written: 0, skipped: [] })
  })

  // A track the collection never had is the common case for a partly-imported library,
  // and it is not worth reporting as a problem.
  it('does not report a track the collection never had', async () => {
    const d = deps({
      endBatch: () => [ONE, TWO],
      repointTrack: vi.fn(
        async (_p: string, o: { from: string }): Promise<RepointResult> =>
          o.from === ONE.from ? { written: true, id: '1' } : { written: false, reason: 'no-match' },
      ),
    })

    expect(await flushRekordboxSync(d)).toEqual({ written: 1, skipped: [] })
  })

  // Everything the user may want to act on is carried back with the track it belongs to,
  // so whatever the UI ends up being can name the file rather than just counting. Only
  // per-track reasons land here: a read-only or locked collection is the same answer for
  // every track and stops the run instead (see below).
  it('reports the tracks it refused to repoint, with the reason', async () => {
    const d = deps({
      endBatch: () => [ONE, TWO],
      repointTrack: vi.fn(
        async (_p: string, o: { from: string }): Promise<RepointResult> =>
          o.from === ONE.from
            ? { written: false, reason: 'ambiguous', ids: ['a', 'b'] }
            : { written: false, reason: 'output-missing' },
      ),
    })

    expect(await flushRekordboxSync(d)).toEqual({
      written: 0,
      skipped: [
        { track: ONE.to, reason: 'ambiguous' },
        { track: TWO.to, reason: 'output-missing' },
      ],
    })
  })

  // rekordbox being open stops the whole flush rather than failing once per track: the
  // answer is the same for all of them, and the user gets one message instead of 300.
  it('stops the whole flush when rekordbox is open', async () => {
    const d = deps({
      endBatch: () => [ONE, TWO],
      repointTrack: vi.fn(
        async (): Promise<RepointResult> => ({
          written: false,
          reason: 'rekordbox-running',
        }),
      ),
    })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ written: 0, blocked: 'rekordbox-running', skipped: [] })
  })

  // A read-only collection is a property of the file, not of any one track, so it stops
  // the run rather than appearing 300 times in a list of skipped tracks.
  it('stops the whole flush when the collection is read-only', async () => {
    const d = deps({
      endBatch: () => [ONE, TWO],
      repointTrack: vi.fn(
        async (): Promise<RepointResult> => ({
          written: false,
          reason: 'read-only',
        }),
      ),
    })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ written: 0, blocked: 'read-only', skipped: [] })
  })

  // Same reasoning for a collection that cannot be backed up or written: retrying it for
  // every remaining track would just repeat one failure.
  it('stops the whole flush when the collection cannot be written', async () => {
    const d = deps({
      endBatch: () => [ONE, TWO],
      repointTrack: vi.fn(
        async (): Promise<RepointResult> => ({
          written: false,
          reason: 'backup-failed',
        }),
      ),
    })

    const result = await flushRekordboxSync(d)

    expect(d.repointTrack).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ written: 0, blocked: 'backup-failed', skipped: [] })
  })
})

// Reported 15/09: the user replaced an MP3 with an AIFF, Apple Music showed the new file
// and rekordbox still pointed at the MP3 — with no indication why. The flush had refused
// to write because rekordbox was open, which is correct, but it said so only in the log.
// A refusal nobody sees reads as the feature being broken, so the one case the user can
// actually act on has to reach them. The Traktor side of this already warns on exactly
// the same condition (flushTraktorSync's showBlockedDialog).
describe('flushRekordboxSync telling the user it was blocked', () => {
  it('warns when rekordbox being open stopped the whole flush', async () => {
    const showBlockedDialog = vi.fn()
    const d = deps({
      repointTrack: vi.fn(
        async (): Promise<RepointResult> => ({ written: false, reason: 'rekordbox-running' }),
      ),
      showBlockedDialog,
    })

    await flushRekordboxSync(d)

    expect(showBlockedDialog).toHaveBeenCalledOnce()
  })

  // Every collection-wide reason stops the run, but only this one names something the
  // user can fix. Popping a dialog for an unreadable or read-only file would put a
  // failure they cannot act on in front of them on every single convert.
  it('stays silent for a blocked reason the user cannot act on', async () => {
    const showBlockedDialog = vi.fn()
    const d = deps({
      repointTrack: vi.fn(
        async (): Promise<RepointResult> => ({ written: false, reason: 'read-only' }),
      ),
      showBlockedDialog,
    })

    await flushRekordboxSync(d)

    expect(showBlockedDialog).not.toHaveBeenCalled()
  })

  // The ordinary run must never warn.
  it('stays silent when every repoint lands', async () => {
    const showBlockedDialog = vi.fn()
    const d = deps({ showBlockedDialog })

    await flushRekordboxSync(d)

    expect(showBlockedDialog).not.toHaveBeenCalled()
  })
})
