// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DjProgram } from '../../../shared/djProgram'
import type { PlaylistRole } from '../../../shared/sessionTypes'
import { useSessionRoles } from './useSessionRoles'

afterEach(cleanup)

type Roles = Record<string, PlaylistRole>

function setup(saved: Roles, program: DjProgram | null = 'rekordbox') {
  const save = vi.fn<(roles: Roles) => void>()
  const hook = renderHook(
    (props: { saved: Roles; program: DjProgram | null }) =>
      useSessionRoles(props.saved, props.program, save),
    { initialProps: { saved, program } },
  )
  return { ...hook, save }
}

describe('useSessionRoles', () => {
  it('lists the roles of the open program by playlist id', () => {
    const { result } = setup({ 'rekordbox:1': 'base', 'traktor:1': 'vocal' })
    expect(result.current.forProgram).toEqual({ '1': 'base' })
  })

  it('saves the whole map with the new role added', () => {
    const { result, save } = setup({ 'rekordbox:1': 'base' })
    act(() => result.current.setRole('2', 'set'))
    expect(save).toHaveBeenCalledExactlyOnceWith({ 'rekordbox:1': 'base', 'rekordbox:2': 'set' })
  })

  it('takes a role away with null', () => {
    const { result, save } = setup({ 'rekordbox:1': 'base', 'rekordbox:2': 'set' })
    act(() => result.current.setRole('1', null))
    expect(save).toHaveBeenCalledExactlyOnceWith({ 'rekordbox:2': 'set' })
  })

  it('keeps both roles when two are set before the settings have come back', () => {
    const { result, save } = setup({})
    act(() => {
      result.current.setRole('1', 'base')
      result.current.setRole('2', 'vocal')
    })
    expect(save).toHaveBeenLastCalledWith({ 'rekordbox:1': 'base', 'rekordbox:2': 'vocal' })
  })

  it('goes on from the settings when they change from outside', () => {
    const { result, rerender, save } = setup({ 'rekordbox:1': 'base' })
    rerender({ saved: { 'rekordbox:9': 'set' }, program: 'rekordbox' })
    act(() => result.current.setRole('2', 'vocal'))
    expect(save).toHaveBeenLastCalledWith({ 'rekordbox:9': 'set', 'rekordbox:2': 'vocal' })
  })

  it('does nothing when no program is open', () => {
    const { result, save } = setup({}, null)
    act(() => result.current.setRole('1', 'base'))
    expect(save).not.toHaveBeenCalled()
    expect(result.current.forProgram).toEqual({})
  })
})
