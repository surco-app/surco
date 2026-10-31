// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Settings } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useRetireSuperseded } from './useRetireSuperseded'

const replaced = {
  id: 't1',
  inputPath: '/Volumes/Public/Music/Music/Media.localized/Music/T/A/T - A.wav',
  status: 'done',
  musicStatus: 'added',
  verification: { status: 'ok', checks: [] },
  supersededPath: '/Volumes/Public/Music/Media.localized/Music/T/A/03 A.aiff',
} as unknown as TrackItem

function setup(
  tracks: TrackItem[],
  { keeps = false, policy = 'audioChanges', fails = false } = {},
) {
  const keepsTrash = vi.fn<Api['keepsTrash']>(async () => keeps)
  const trashFile = vi.fn<Api['trashFile']>(async () => {
    if (fails) throw new Error('EBUSY')
  })
  ;(window as unknown as { api: unknown }).api = { keepsTrash, trashFile }
  const updateTrack = vi.fn()
  const reportTrashFailure = vi.fn()
  const settings = { backupPolicy: policy } as Settings
  const hook = renderHook(
    ({ list }) => useRetireSuperseded({ tracks: list, settings, updateTrack, reportTrashFailure }),
    { initialProps: { list: tracks } },
  )
  return { keepsTrash, trashFile, updateTrack, reportTrashFailure, hook }
}

afterEach(() => vi.restoreAllMocks())

describe('useRetireSuperseded', () => {
  it('retires the old file of a format change once the check is ok, without asking, and marks it gone so the footer stops offering it', async () => {
    const { trashFile, updateTrack } = setup([replaced])
    await waitFor(() => expect(updateTrack).toHaveBeenCalledWith('t1', { supersededTrashed: true }))
    expect(trashFile).toHaveBeenCalledWith(replaced.supersededPath, false)
  })

  it('deletes it for good on a disk with no Trash under «Nunca», as the user asked, instead of leaving it orphaned', async () => {
    const { trashFile } = setup([replaced], { keeps: false, policy: 'never' })
    await waitFor(() => expect(trashFile).toHaveBeenCalledWith(replaced.supersededPath, true))
  })

  it('sends it to the system Trash where the disk has one, even under «Nunca»', async () => {
    const { trashFile } = setup([replaced], { keeps: true, policy: 'never' })
    await waitFor(() => expect(trashFile).toHaveBeenCalledWith(replaced.supersededPath, false))
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
    const { trashFile, hook } = setup([replaced])
    hook.rerender({ list: [{ ...replaced }] })
    hook.rerender({ list: [{ ...replaced }] })
    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(1))
  })

  it('says so when the file could not be retired, and leaves the offer in place', async () => {
    const { reportTrashFailure, updateTrack } = setup([replaced], { fails: true })
    await waitFor(() => expect(reportTrashFailure).toHaveBeenCalledWith('03 A.aiff'))
    expect(updateTrack).not.toHaveBeenCalled()
  })

  it('leaves the old file alone while the check has not come back ok', async () => {
    const checking = { ...replaced, verification: { status: 'checking', checks: [] } }
    const { trashFile, keepsTrash } = setup([checking as TrackItem])
    await new Promise((r) => setTimeout(r, 0))
    expect(keepsTrash).not.toHaveBeenCalled()
    expect(trashFile).not.toHaveBeenCalled()
  })
})
