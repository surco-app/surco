// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { SessionData } from '../../../shared/types'
import { createAppStore } from '../lib/appStore'
import { dismissToastByExpiry, dismissToastByUser } from '../lib/toastQueue'
import type { TrackItem } from '../types'
import { useSessionPersistence } from './useSessionPersistence'

afterEach(() => vi.restoreAllMocks())

async function offer(session: SessionData) {
  const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
  ;(window as unknown as { api: Partial<Api> }).api = {
    getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue(session),
    saveLastSession,
  }
  const store = createAppStore()
  renderHook(() =>
    useSessionPersistence({
      tracks: [],
      tracksRef: { current: [] },
      addPaths: vi.fn(),
      seedRestoredEdits: vi.fn(),
      store,
      withdrawOffer: false,
    }),
  )
  await waitFor(() => expect(store.getState().toasts).toHaveLength(1))
  return { store, toast: store.getState().toasts[0], saveLastSession }
}

const withEdits: SessionData = {
  paths: ['/music/a.wav'],
  edits: { '/music/a.wav': { meta: { title: 'Staged' } } as never },
}

describe('useSessionPersistence', () => {
  it('lets a paths-only offer age out as a no', async () => {
    const { store, toast, saveLastSession } = await offer({ paths: ['/music/a.wav'], edits: {} })
    expect(toast.duration).toBeGreaterThan(0)
    dismissToastByExpiry(store, toast.id)
    expect(saveLastSession).toHaveBeenCalledWith([], {})
  })

  // Staged edits live only in the saved session: the offer still ages out so it never
  // parks in the corner, but its expiry is not an answer, so the next launch asks again.
  it('lets an offer with staged edits age out without dropping the saved session', async () => {
    const { store, toast, saveLastSession } = await offer(withEdits)
    expect(toast.duration).toBeGreaterThan(0)
    dismissToastByExpiry(store, toast.id)
    expect(store.getState().toasts).toHaveLength(0)
    expect(saveLastSession).not.toHaveBeenCalled()
  })

  it('still drops the saved session when the offer with edits is closed by hand', async () => {
    const { store, toast, saveLastSession } = await offer(withEdits)
    dismissToastByUser(store, toast.id)
    expect(saveLastSession).toHaveBeenCalledWith([], {})
  })

  it('saves only the Files rows, so a playlist-only row is gone after quitting', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const row = (inputPath: string, inFiles: boolean): TrackItem =>
      ({ id: inputPath, inputPath, inFiles, meta: emptyMetadata() }) as TrackItem
    const tracks = [row('/music/files.wav', true), row('/music/playlist.wav', false)]
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store: createAppStore(),
        withdrawOffer: false,
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession).toHaveBeenCalledWith(['/music/files.wav'], {})
  })

  it('keeps offering Files back while only a source playlist has rows', async () => {
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
      saveLastSession: vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined),
    }
    const playlistRow = {
      id: 'p',
      inputPath: '/music/p.wav',
      meta: emptyMetadata(),
    } as TrackItem
    const store = createAppStore()
    const tracksRef = { current: [playlistRow] }
    const { rerender } = renderHook(
      ({ tracks }) =>
        useSessionPersistence({
          tracks,
          tracksRef,
          addPaths: vi.fn(),
          seedRestoredEdits: vi.fn(),
          store,
          withdrawOffer: false,
        }),
      { initialProps: { tracks: [playlistRow] } },
    )
    await waitFor(() => expect(store.getState().toasts).toHaveLength(1))
    rerender({ tracks: [{ ...playlistRow }] })
    expect(store.getState().toasts).toHaveLength(1)
  })
})
