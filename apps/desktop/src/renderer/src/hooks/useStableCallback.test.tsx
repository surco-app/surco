// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useStableCallback } from './useStableCallback'

afterEach(cleanup)

describe('useStableCallback', () => {
  // The two halves of the contract: the identity must survive re-renders (or a
  // memoized child re-renders for nothing), and the body must read the LATEST
  // closure (or the child calls into stale state).
  it('keeps one identity across renders while calling the latest closure', () => {
    let seen = ''
    const { result, rerender } = renderHook(
      (props: { value: string }) =>
        useStableCallback(() => {
          seen = props.value
        }),
      { initialProps: { value: 'first' } },
    )
    const initial = result.current

    rerender({ value: 'second' })
    expect(result.current).toBe(initial)

    result.current()
    expect(seen).toBe('second')
  })

  it('calls the closure of the render in progress when a component calls it while rendering, as the row menu and the command lists do', () => {
    const { result, rerender } = renderHook(
      (props: { value: string }) => {
        const read = useStableCallback(() => props.value)
        return read()
      },
      { initialProps: { value: 'first' } },
    )
    rerender({ value: 'second' })
    expect(result.current).toBe('second')
  })
})
