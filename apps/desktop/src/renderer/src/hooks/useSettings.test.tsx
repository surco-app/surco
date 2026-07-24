// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../shared/types'
import { SETTINGS_SNAPSHOT_KEY, useSettings } from './useSettings'

afterEach(cleanup)

function settings(over: Partial<Settings> = {}): Settings {
  return { conversionCount: 0, ...over } as Settings
}

beforeEach(() => {
  window.localStorage.clear()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  // Only getSettings matters here; the rest of the bridge is unused by this hook.
  // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
  ;(window as any).api = { getSettings: vi.fn().mockResolvedValue(settings()) }
})

describe('useSettings modal-open refresh', () => {
  // The Stats tab re-reads settings each time the modal opens. If the modal closes (or a
  // save lands) before that read resolves, the late value must not clobber the newer
  // state — otherwise reopening Stats could silently revert a just-saved setting.
  it('drops a modal-open refresh that resolves after the modal has closed', async () => {
    const initial = settings({ conversionCount: 1 })
    const stale = settings({ conversionCount: 99 })
    let resolveRefresh: (s: Settings) => void = () => {}
    const refresh = new Promise<Settings>((r) => {
      resolveRefresh = r
    })
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce(initial) // initial load
      .mockReturnValueOnce(refresh) // modal-open refresh, controlled below
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings }

    const noop = (): void => {}
    const { result, rerender } = renderHook(
      ({ open }) =>
        useSettings({
          settingsOpen: open,
          onFirstLoad: noop,
          onLoadError: noop,
          onSaveError: noop,
        }),
      { initialProps: { open: false } },
    )

    await waitFor(() => expect(result.current.settings).toEqual(initial))

    rerender({ open: true }) // open the modal — fires the refresh
    rerender({ open: false }) // close it before the refresh resolves

    await act(async () => {
      resolveRefresh(stale)
      await refresh
    })

    expect(result.current.settings).toEqual(initial)
  })

  // A config-dir adoption (or save) can land while the modal is still open and an
  // earlier modal-open refresh is in flight. The stale refresh only exists to bump the
  // Stats count, so it must merge that count — never replace the whole object and revert
  // the freshly adopted fields.
  it('keeps a setting adopted while a modal-open refresh is still in flight', async () => {
    const initial = settings({ conversionCount: 1, theme: 'light' })
    const staleOnDisk = settings({ conversionCount: 5, theme: 'light' })
    let resolveRefresh: (s: Settings) => void = () => {}
    const refresh = new Promise<Settings>((r) => {
      resolveRefresh = r
    })
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce(initial) // initial load
      .mockReturnValueOnce(refresh) // modal-open refresh, controlled below
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings }

    const noop = (): void => {}
    const { result, rerender } = renderHook(
      ({ open }) =>
        useSettings({
          settingsOpen: open,
          onFirstLoad: noop,
          onLoadError: noop,
          onSaveError: noop,
        }),
      { initialProps: { open: false } },
    )

    await waitFor(() => expect(result.current.settings).toEqual(initial))

    rerender({ open: true }) // open the modal — fires the refresh, which stays in flight
    // A config-dir switch adopts another machine's prefs mid-session via setSettings.
    act(() => result.current.setSettings(settings({ conversionCount: 1, theme: 'dark' })))

    await act(async () => {
      resolveRefresh(staleOnDisk)
      await refresh
    })

    // The adopted theme survives; only the Stats count is allowed to refresh.
    expect(result.current.settings?.theme).toBe('dark')
    expect(result.current.settings?.conversionCount).toBe(5)
  })
})

describe('useSettings optimistic saves', () => {
  // The player-bar toggles (continuous playback, waveform) flip through saveSettings and
  // used to wait for the disk round-trip that theme and resultsWidth already skip — on a
  // slow config volume the click visibly lagged. Every patch now applies optimistically:
  // the UI answers in the click's frame and the disk write catches up in the background.
  it('applies a boolean toggle immediately, before the disk write resolves', async () => {
    const initial = settings({ conversionCount: 1, continuousPlayback: false })
    let resolveSave: (s: Settings) => void = () => {}
    const save = new Promise<Settings>((r) => {
      resolveSave = r
    })
    const getSettings = vi.fn().mockResolvedValue(initial)
    const saveSettings = vi.fn().mockReturnValue(save)
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings, saveSettings }

    const noop = (): void => {}
    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )
    await waitFor(() => expect(result.current.settings).toEqual(initial))

    act(() => result.current.saveSettings({ continuousPlayback: true }))

    expect(result.current.settings?.continuousPlayback).toBe(true)

    await act(async () => {
      resolveSave(settings({ conversionCount: 1, continuousPlayback: true }))
      await save
    })
    expect(result.current.settings?.continuousPlayback).toBe(true)
  })

  // The flip side of optimism: a failed write used to leave the optimistic value on
  // screen with only a toast, so the UI showed a choice the next launch would quietly
  // revert. The patched fields roll back to their pre-save values — and only those, so
  // a concurrent save of other fields keeps its own optimistic state.
  it('rolls the patched fields back when the save fails', async () => {
    const initial = settings({ conversionCount: 1, theme: 'light', continuousPlayback: true })
    let rejectSave: (e: Error) => void = () => {}
    const save = new Promise<Settings>((_, reject) => {
      rejectSave = reject
    })
    const getSettings = vi.fn().mockResolvedValue(initial)
    const saveSettings = vi.fn().mockReturnValue(save)
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings, saveSettings }

    const noop = (): void => {}
    const onSaveError = vi.fn()
    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError }),
    )
    await waitFor(() => expect(result.current.settings).toEqual(initial))

    act(() => result.current.saveSettings({ theme: 'dark' }))
    expect(result.current.settings?.theme).toBe('dark')

    await act(async () => {
      rejectSave(new Error('disk full'))
      await save.catch(() => {})
    })

    expect(result.current.settings?.theme).toBe('light')
    expect(result.current.settings?.continuousPlayback).toBe(true)
    expect(onSaveError).toHaveBeenCalledTimes(1)
  })
})

describe('useSettings optimistic layout width', () => {
  // A focus preset (and a divider drag) writes resultsWidth through saveSettings, which
  // round-trips to disk before returning. On a slow config volume that round-trip is
  // visible lag — the column doesn't move until the write lands, so rapid preset clicks
  // feel unresponsive. resultsWidth applies optimistically, like the theme, so the column
  // reparks in the same frame as the click and the disk write catches up in the background.
  it('applies resultsWidth immediately, before the disk write resolves', async () => {
    const initial = settings({ conversionCount: 1, resultsWidth: 315 })
    let resolveSave: (s: Settings) => void = () => {}
    const save = new Promise<Settings>((r) => {
      resolveSave = r
    })
    const getSettings = vi.fn().mockResolvedValue(initial)
    const saveSettings = vi.fn().mockReturnValue(save)
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings, saveSettings }

    const noop = (): void => {}
    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )
    await waitFor(() => expect(result.current.settings).toEqual(initial))

    act(() => result.current.saveSettings({ resultsWidth: 480 }))

    // The write is still in flight, but the width is already applied.
    expect(result.current.settings?.resultsWidth).toBe(480)

    // The resolved disk value then reconciles without regressing the width.
    await act(async () => {
      resolveSave(settings({ conversionCount: 1, resultsWidth: 480 }))
      await save
    })
    expect(result.current.settings?.resultsWidth).toBe(480)
  })
})

describe('useSettings first-paint snapshot', () => {
  const noop = (): void => {}

  // The whole point of the snapshot: theme/width must be right in the very first
  // render, before the async IPC round-trip resolves — otherwise every launch flashes
  // fallback defaults for a frame.
  it('seeds the first render from a stored snapshot instead of starting null', () => {
    const snapshot = settings({ conversionCount: 3, theme: 'dark', resultsWidth: 512 })
    window.localStorage.setItem(SETTINGS_SNAPSHOT_KEY, JSON.stringify(snapshot))

    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    expect(result.current.settings).toEqual(snapshot)
  })

  // Main is still the source of truth: the seed is only a placeholder until the real
  // read lands, and the real read must win even when it disagrees with the snapshot.
  it('lets the resolved IPC settings overwrite the seeded snapshot', async () => {
    const stale = settings({ conversionCount: 3, theme: 'dark' })
    const fresh = settings({ conversionCount: 3, theme: 'light' })
    window.localStorage.setItem(SETTINGS_SNAPSHOT_KEY, JSON.stringify(stale))
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings: vi.fn().mockResolvedValue(fresh) }

    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    expect(result.current.settings?.theme).toBe('dark')
    await waitFor(() => expect(result.current.settings?.theme).toBe('light'))
  })

  // A corrupt or missing snapshot (a hand-edited localStorage, an older schema that no
  // longer parses as expected) must fall back to exactly today's behavior: null until
  // the IPC resolves, never a thrown error during render.
  it('starts null when the stored snapshot is corrupt JSON', () => {
    window.localStorage.setItem(SETTINGS_SNAPSHOT_KEY, '{not json')

    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    expect(result.current.settings).toBeNull()
  })

  it('starts null when no snapshot is stored', () => {
    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    expect(result.current.settings).toBeNull()
  })

  // Mirrored on the initial load, so the very next launch has something to seed from.
  it('writes the loaded settings into the snapshot key', async () => {
    const loaded = settings({ conversionCount: 7, theme: 'dark' })
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings: vi.fn().mockResolvedValue(loaded) }

    renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SETTINGS_SNAPSHOT_KEY) ?? 'null')).toEqual(
        loaded,
      ),
    )
  })

  // And mirrored again on every update (the optimistic save's resolved value), so the
  // snapshot never drifts behind what the user actually has.
  it('writes the resolved save into the snapshot key', async () => {
    const initial = settings({ conversionCount: 1, continuousPlayback: false })
    const resolved = settings({ conversionCount: 1, continuousPlayback: true })
    const getSettings = vi.fn().mockResolvedValue(initial)
    const saveSettings = vi.fn().mockResolvedValue(resolved)
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings, saveSettings }

    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )
    await waitFor(() => expect(result.current.settings).toEqual(initial))

    await act(async () => {
      result.current.saveSettings({ continuousPlayback: true })
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SETTINGS_SNAPSHOT_KEY) ?? 'null')).toEqual(
        resolved,
      ),
    )
  })

  // A full or blocked localStorage (private browsing, disk quota) must not turn the
  // paint-only mirror into a crash: the write is best-effort, so settings keep flowing
  // to the hook's consumers exactly as if the mirror succeeded. setItem lives on
  // Storage.prototype in jsdom, not the instance, so the spy targets the prototype —
  // spying on the instance is a silent no-op there.
  it('keeps applying settings updates when localStorage.setItem throws', async () => {
    const loaded = settings({ conversionCount: 1, theme: 'dark' })
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { getSettings: vi.fn().mockResolvedValue(loaded) }
    const setItemSpy = vi
      .spyOn(Object.getPrototypeOf(window.localStorage), 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    const { result } = renderHook(() =>
      useSettings({ settingsOpen: false, onFirstLoad: noop, onLoadError: noop, onSaveError: noop }),
    )

    await waitFor(() => expect(result.current.settings).toEqual(loaded))

    setItemSpy.mockRestore()
  })
})
