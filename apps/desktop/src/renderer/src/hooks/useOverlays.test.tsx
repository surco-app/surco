// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOverlays } from './useOverlays'

// ⌘K must never tear down another modal. The onboarding wizard ignores Escape on purpose,
// a confirm dialog is waiting for an answer and find & replace may hold typed text, so the
// palette replacing any of them loses the user's place with no way back.
describe('useOverlays palette over another modal', () => {
  it('keeps the onboarding wizard open when ⌘K toggles the palette', () => {
    const { result } = renderHook(() => useOverlays())
    act(() => result.current.openOnboarding())
    act(() => result.current.togglePalette())
    expect(result.current.activeModal).toEqual({ type: 'onboarding' })
  })

  it('keeps find & replace open when the menu opens the palette', () => {
    const { result } = renderHook(() => useOverlays())
    act(() => result.current.openFindReplace())
    act(() => result.current.openPalette())
    expect(result.current.activeModal).toEqual({ type: 'findReplace' })
  })

  it('still opens the palette with nothing open and closes it on a second ⌘K', () => {
    const { result } = renderHook(() => useOverlays())
    act(() => result.current.togglePalette())
    expect(result.current.activeModal).toEqual({ type: 'palette' })
    act(() => result.current.togglePalette())
    expect(result.current.activeModal).toBeNull()
  })
})
