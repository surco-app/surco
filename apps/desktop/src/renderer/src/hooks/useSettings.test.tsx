// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../shared/types'
import { useSettings } from './useSettings'

afterEach(cleanup)

function settings(over: Partial<Settings> = {}): Settings {
  return { conversionCount: 0, ...over } as Settings
}

beforeEach(() => {
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
