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
})
