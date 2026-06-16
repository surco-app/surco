// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useEditorSections } from './useEditorSections'

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
})
