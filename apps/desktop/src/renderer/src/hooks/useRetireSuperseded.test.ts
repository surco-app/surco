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
  { answer = 'retired' as 'retired' | 'used', fails = false } = {},
) {
  const retireSuperseded = vi.fn<Api['retireSuperseded']>(async () => {
    if (fails) throw new Error('EBUSY')
    return answer
  })
  ;(window as unknown as { api: unknown }).api = { retireSuperseded }
  const updateTrack = vi.fn()
  const reportTrashFailure = vi.fn()
  const hook = renderHook(
    ({ list }) => useRetireSuperseded({ tracks: list, updateTrack, reportTrashFailure }),
    { initialProps: { list: tracks } },
  )
  return { retireSuperseded, updateTrack, reportTrashFailure, hook }
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

  it('marks the source trashed too when the retired file is the row’s own source', async () => {
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
})
