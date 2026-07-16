// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearMaximizedSection,
  resetEditorSections,
  seedEditorSections,
  useEditorSections,
  useMaximizedSection,
} from './useEditorSections'

afterEach(() => resetEditorSections())

describe('useEditorSections', () => {
  // The editor remounts per track, so folding a section must outlive that remount —
  // otherwise switching tracks would silently reopen (and re-analyse) what the user
  // folded away. The state lives in a module store, so a fresh mount inherits it.
  it('remembers a folded section across remounts (a track switch)', () => {
    const first = renderHook(() => useEditorSections())
    expect(first.result.current.open.quality).toBe(true)

    act(() => first.result.current.setOpen('quality', false))
    expect(first.result.current.open.quality).toBe(false)
    first.unmount()

    // A new mount stands in for the editor remounting on the next selected track.
    const second = renderHook(() => useEditorSections())
    expect(second.result.current.open.quality).toBe(false)
    // Untouched sections keep their defaults.
    expect(second.result.current.open.form).toBe(true)
  })

  // Normalization is an occasional mastering choice (the mode ships off) and opening
  // it costs a full-length wave decode plus the loudness measure, so the store boots
  // it folded — the fold badge still surfaces an active mode.
  it('starts the normalize section folded by default', () => {
    const { result } = renderHook(() => useEditorSections())
    expect(result.current.open.normalize).toBe(false)
  })

  // The per-section defaults are the user's (Settings → Editor). Settings load after
  // the first editors can already be mounted, so the seed must reach live hooks —
  // not only the next remount — or a fast first click would show stale defaults.
  it('applies a settings seed to already-mounted editors', () => {
    const { result } = renderHook(() => useEditorSections())
    expect(result.current.open.properties).toBe(false)

    act(() =>
      seedEditorSections([
        { id: 'properties', open: true },
        { id: 'quality', open: false },
      ]),
    )
    expect(result.current.open.properties).toBe(true)
    expect(result.current.open.quality).toBe(false)
    expect(result.current.open.form).toBe(true)
  })

  // The full-window overlay must drop when a new crate is imported. Otherwise dragging in a
  // folder while a section is maximized leaves the overlay up, painting the freshly selected
  // track's still-analyzing spectrum across the whole window behind the editor — the reported
  // "full-screen wave that shouldn't be there".
  it('clears the maximized overlay when a crate is imported', () => {
    const { result } = renderHook(() => useMaximizedSection())
    act(() => result.current.setMaximized('quality'))
    expect(result.current.maximized).toBe('quality')

    act(() => clearMaximizedSection())
    expect(result.current.maximized).toBeNull()
  })

  it('leaves a track step alone — clear is import-only, not per remount', () => {
    // A no-op when nothing is maximized keeps arrow-through-the-crate cheap and avoids a
    // spurious emit on every import when the user never maximized anything.
    const { result } = renderHook(() => useMaximizedSection())
    expect(result.current.maximized).toBeNull()
    act(() => clearMaximizedSection())
    expect(result.current.maximized).toBeNull()
  })
})
