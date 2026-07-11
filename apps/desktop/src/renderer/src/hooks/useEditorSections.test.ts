// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { seedEditorSections, useEditorSections } from './useEditorSections'

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

  // Normalization used to start folded as a niche feature; with the section now
  // showing the track's waveform (and its clipping peaks) it earns its place open,
  // so a DJ sees the wave without hunting for a fold.
  it('starts the normalize section open by default', () => {
    const { result } = renderHook(() => useEditorSections())
    expect(result.current.open.normalize).toBe(true)
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
})
