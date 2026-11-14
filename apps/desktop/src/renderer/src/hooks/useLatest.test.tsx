// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLatest } from './useLatest'

afterEach(cleanup)

describe('useLatest', () => {
  it('lets a listener read only what was committed, never a render that suspended and was thrown away', async () => {
    const never = new Promise<never>(() => {})
    const seen: { latest?: { readonly current: string } } = {}
    function Reader({ value, suspend }: { value: string; suspend: boolean }): null {
      seen.latest = useLatest(value)
      if (suspend) throw never
      return null
    }
    const { rerender } = render(
      <Suspense fallback={null}>
        <Reader value="shown" suspend={false} />
      </Suspense>,
    )
    await act(async () => {
      rerender(
        <Suspense fallback={null}>
          <Reader value="never shown" suspend />
        </Suspense>,
      )
    })
    expect(seen.latest?.current).toBe('shown')
  })
})
