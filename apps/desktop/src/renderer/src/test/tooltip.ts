import { act, fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'

export function hoverTooltip(el: Element): string | null {
  vi.useFakeTimers()
  try {
    fireEvent.pointerEnter(el, { clientX: 1, clientY: 1 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    const text = screen.queryByRole('tooltip')?.textContent ?? null
    fireEvent.pointerLeave(el)
    return text
  } finally {
    vi.useRealTimers()
  }
}
