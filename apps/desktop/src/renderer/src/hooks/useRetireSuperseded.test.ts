// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { TrackItem } from '../types'
import { useRetireSuperseded } from './useRetireSuperseded'

const replaced = {
  id: 't1',
  inputPath: '/Volumes/Public/Music/Music/Media.localized/Music/T/A/T - A.wav',
  status: 'done',
  meta: {},
  musicStatus: 'added',
  verification: { status: 'ok', checks: [] },
  supersededPath: '/Volumes/Public/Music/Media.localized/Music/T/A/03 A.aiff',
} as unknown as TrackItem

function setup(
  tracks: TrackItem[],
  { answer = 'retired' as 'retired' | 'used', fails = false, platform = 'darwin' } = {},
) {
  const retireSuperseded = vi.fn<Api['retireSuperseded']>(async () => {
    if (fails) throw new Error('EBUSY')
    return answer
  })
  const logInfo = vi.fn<Api['logInfo']>()
  ;(window as unknown as { api: unknown }).api = { retireSuperseded, platform, logInfo }
  const updateTrack = vi.fn()
  const removeTracks = vi.fn()
  const reportTrashFailure = vi.fn()
  const hook = renderHook(
    ({ list }) =>
      useRetireSuperseded({ tracks: list, updateTrack, removeTracks, reportTrashFailure }),
    { initialProps: { list: tracks } },
  )
  return { retireSuperseded, updateTrack, removeTracks, reportTrashFailure, logInfo, hook }
}

afterEach(() => vi.restoreAllMocks())

describe('useRetireSuperseded', () => {
  it('retires the old file of a format change once the check is ok, without asking, and marks it gone so the footer stops offering it', async () => {
    const { retireSuperseded, updateTrack } = setup([replaced])
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededTrashed: true }))
    expect(retireSuperseded).toHaveBeenCalledWith(replaced.supersededPath, ['03 A'])
  })

  it('names the old file every way its Music entry may be titled, so a second entry on it is found', async () => {
    const titled = {
      ...replaced,
      meta: { title: 'A (Extended Mix)' },
      replacesLabel: 'A',
      replacesPath: '/Volumes/Public/Music/A.mp3',
    } as TrackItem
    const { retireSuperseded } = setup([titled])
    await waitFor(() =>
      expect(retireSuperseded).toHaveBeenCalledWith('/Volumes/Public/Music/A.mp3', [
        'A (Extended Mix)',
        'A',
      ]),
    )
  })

  it('names the old file by the name its Music entry showed, which the DJ may have retitled since', async () => {
    const relabeled = {
      ...replaced,
      meta: { title: 'A (Extended Mix)' },
      replacesLabel: 'Artist - Remix - A (Original Mix)',
      replacesPath: '/Volumes/Public/Music/A.mp3',
    } as TrackItem
    const { retireSuperseded } = setup([relabeled])
    await waitFor(() => expect(retireSuperseded).toHaveBeenCalled())
    expect(retireSuperseded.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['Remix - A (Original Mix)', 'A (Original Mix)']),
    )
  })

  it('keeps a file a DJ library still uses and hands it back to the manual offer, since that library would otherwise point at nothing', async () => {
    const { updateTrack, reportTrashFailure } = setup([replaced], { answer: 'used' })
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededKept: true }))
    expect(updateTrack).toHaveBeenCalledTimes(1)
    expect(reportTrashFailure).not.toHaveBeenCalled()
  })

  it('retires the old file even when another row of the list loads it, and takes that row off the list, since replacing is one track for another', async () => {
    const loaded = { ...replaced, id: 't2', inputPath: replaced.supersededPath } as TrackItem
    const converted = {
      ...replaced,
      id: 't3',
      inputPath: '/Users/v/Downloads/B.flac',
      outputPath: replaced.supersededPath,
      supersededPath: undefined,
    } as TrackItem
    for (const other of [loaded, converted]) {
      const { retireSuperseded, updateTrack, removeTracks } = setup([replaced, other])
      await waitFor(() => expect(removeTracks).toHaveBeenCalledWith([other.id], true))
      expect(retireSuperseded).toHaveBeenCalledWith(replaced.supersededPath, ['03 A'])
      expect(updateTrack).toHaveBeenCalledWith('t1', { supersededTrashed: true })
    }
  })

  it('keeps the rows on the old file when a DJ library still uses it, since the file stays', async () => {
    const loaded = { ...replaced, id: 't2', inputPath: replaced.supersededPath } as TrackItem
    const { updateTrack, removeTracks } = setup([replaced, loaded], { answer: 'used' })
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededKept: true }))
    expect(removeTracks).not.toHaveBeenCalled()
  })

  it('leaves the old file to the manual offer while another row is converting it, since retiring it would pull the file from under that job', async () => {
    const busy = {
      ...replaced,
      id: 't2',
      status: 'processing',
      inputPath: replaced.supersededPath,
    } as TrackItem
    const { retireSuperseded, updateTrack, removeTracks } = setup([replaced, busy])
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededKept: true }))
    expect(retireSuperseded).not.toHaveBeenCalled()
    expect(removeTracks).not.toHaveBeenCalled()
  })

  it('takes the row on the old file off the list however its path is spelled, since macOS and Windows open it under any case or Unicode form', async () => {
    const accented = '/Volumes/Public/Music/T/Café/03 Olé.aiff'
    const old = { ...replaced, supersededPath: accented } as TrackItem
    const loaded = {
      ...replaced,
      id: 't2',
      inputPath: accented.normalize('NFD').toUpperCase(),
      supersededPath: undefined,
    } as TrackItem
    for (const platform of ['darwin', 'win32']) {
      const { removeTracks } = setup([old, loaded], { platform })
      await waitFor(() => expect(removeTracks).toHaveBeenCalledWith(['t2'], true))
    }
  })

  it('tells a case variant apart on Linux, where it is another file', async () => {
    const loaded = {
      ...replaced,
      id: 't2',
      inputPath: replaced.supersededPath?.toUpperCase(),
      supersededPath: undefined,
    } as TrackItem
    const { updateTrack, removeTracks } = setup([replaced, loaded], { platform: 'linux' })
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededTrashed: true }))
    expect(removeTracks).not.toHaveBeenCalled()
  })

  // The row stayed on the file just retired, so the editor, the player and every probe kept
  // asking for a file that is gone (fileMissing on The Inside, 04/11). It follows the copy
  // that replaced it, as an in-place export follows its rewritten file.
  it('moves the row to its converted copy when the retired file is the row’s own source', async () => {
    const source = {
      ...replaced,
      inputPath: replaced.supersededPath,
      outputPath: '/Users/v/Music/Surco/T - A.wav',
    } as TrackItem
    const { updateTrack } = setup([source])
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith('t1', {
        supersededTrashed: true,
        originalTrashed: true,
        inputPath: '/Users/v/Music/Surco/T - A.wav',
        fileName: 'T - A',
        movedFrom: [replaced.supersededPath],
      }),
    )
  })

  it('retires each file once, however often the list re-renders before the mark lands', async () => {
    const { retireSuperseded, hook } = setup([replaced])
    hook.rerender({ list: [{ ...replaced }] })
    hook.rerender({ list: [{ ...replaced }] })
    await waitFor(() => expect(retireSuperseded).toHaveBeenCalledTimes(1))
  })

  it('says so when the file could not be retired, and hands it back to the manual offer', async () => {
    const { reportTrashFailure, updateTrack } = setup([replaced], { fails: true })
    await waitFor(() => expect(reportTrashFailure).toHaveBeenCalledWith('03 A.aiff'))
    expect(updateTrack).toHaveBeenCalledWith('t1', { supersededKept: true })
  })

  it('leaves the old file alone while the check has not come back ok', async () => {
    const checking = { ...replaced, verification: { status: 'checking', checks: [] } }
    const { retireSuperseded } = setup([checking as TrackItem])
    await new Promise((r) => setTimeout(r, 0))
    expect(retireSuperseded).not.toHaveBeenCalled()
  })

  // Do it.aiff stayed behind after its conversion on 01/11 and the log said nothing: every
  // original a format change should retire and does not now leaves its reason there, once.
  describe('saying in the log why an original stays', () => {
    it('gives the check that did not come back ok, once however often the row renders', async () => {
      const failed = {
        ...replaced,
        verification: {
          status: 'mismatch',
          checks: [
            { place: 'appleMusic', state: 'mismatch', detail: { key: 'musicPlaylistLost' } },
          ],
        },
      } as TrackItem
      const { logInfo, hook } = setup([failed])
      hook.rerender({ list: [{ ...failed }] })
      await waitFor(() => expect(logInfo).toHaveBeenCalledOnce())
      expect(logInfo.mock.calls[0][0]).toBe(
        `retire: kept ${replaced.supersededPath}: the check came back mismatch: appleMusic musicPlaylistLost`,
      )
    })

    it('says another row is converting the file', async () => {
      const busy = {
        ...replaced,
        id: 't2',
        status: 'processing',
        inputPath: replaced.supersededPath,
      } as TrackItem
      const { logInfo } = setup([replaced, busy])
      await waitFor(() =>
        expect(logInfo).toHaveBeenCalledWith(
          `retire: kept ${replaced.supersededPath}: another row of the list is converting it`,
        ),
      )
    })

    it('says a library or Apple Music still uses the file', async () => {
      const { logInfo } = setup([replaced], { answer: 'used' })
      await waitFor(() =>
        expect(logInfo).toHaveBeenCalledWith(
          `retire: kept ${replaced.supersededPath}: a DJ library or Apple Music uses it, or could not be asked`,
        ),
      )
    })

    it('still retires the original once a check run again comes back ok', async () => {
      const failed = {
        ...replaced,
        verification: { status: 'mismatch', checks: [] },
      } as unknown as TrackItem
      const { hook, retireSuperseded, logInfo } = setup([failed])
      await waitFor(() => expect(logInfo).toHaveBeenCalledOnce())

      hook.rerender({ list: [replaced] })

      await waitFor(() => expect(retireSuperseded).toHaveBeenCalledOnce())
    })

    it('says nothing when the original is retired', async () => {
      const { logInfo, updateTrack } = setup([replaced])
      await waitFor(() => expect(updateTrack).toHaveBeenCalled())
      expect(logInfo).not.toHaveBeenCalled()
    })
  })
})
