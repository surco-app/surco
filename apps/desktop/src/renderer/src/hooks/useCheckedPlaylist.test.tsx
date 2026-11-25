// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useLayoutEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useCheckedPlaylist } from './useCheckedPlaylist'

function setup(initial: string | null) {
  const committed: (string | null)[] = []
  const hook = renderHook(
    ({ showing }) => {
      const [checked, setChecked] = useState<string | null>(null)
      useCheckedPlaylist(showing, setChecked)
      useLayoutEffect(() => {
        committed.push(checked)
      })
      return { checked, setChecked }
    },
    { initialProps: { showing: initial } },
  )
  return { ...hook, committed }
}

describe('useCheckedPlaylist', () => {
  it('keeps the opening checked while the same playlist stays on screen, so its missing files show', () => {
    const { result, rerender } = setup('rekordbox:a')
    act(() => result.current.setChecked('rekordbox:a'))
    rerender({ showing: 'rekordbox:a' })
    expect(result.current.checked).toBe('rekordbox:a')
  })

  it('drops the check in the very render that switches playlists, so an empty new playlist never reads as missing files for a frame', () => {
    const { result, rerender, committed } = setup('rekordbox:a')
    act(() => result.current.setChecked('rekordbox:a'))
    committed.length = 0
    rerender({ showing: 'rekordbox:b' })
    expect(result.current.checked).toBeNull()
    expect(committed).toEqual([null])
  })

  it('drops the check when coming back to a playlist, so what an earlier visit found waits for the new disk check', () => {
    const { result, rerender } = setup('rekordbox:a')
    act(() => result.current.setChecked('rekordbox:a'))
    rerender({ showing: 'rekordbox:b' })
    rerender({ showing: 'rekordbox:a' })
    expect(result.current.checked).toBeNull()
  })
})
