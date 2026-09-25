// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeRgb } from './useThemeRgb'

afterEach(() => {
  document.documentElement.style.removeProperty('--color-accent')
  document.documentElement.removeAttribute('data-theme')
})

describe('useThemeRgb', () => {
  // A canvas silently ignores `var(--color-accent)` and keeps the last fillStyle, which is
  // how a clean track once painted as though every sample clipped. The wave strips need the
  // token as literal channels they can build an rgba() from.
  it('reads a theme token as literal rgb channels a canvas can paint', () => {
    document.documentElement.style.setProperty('--color-accent', '#7aa2f7')
    const { result } = renderHook(() => useThemeRgb('--color-accent'))
    expect(result.current).toBe('122, 162, 247')
  })

  // The strips were fixed Tailwind blue and grey, so the light theme showed the dark
  // theme's wave on its pale panels. A theme switch must reach an open strip.
  it('follows a theme switch', async () => {
    document.documentElement.style.setProperty('--color-accent', '#7aa2f7')
    const { result } = renderHook(() => useThemeRgb('--color-accent'))
    await act(async () => {
      document.documentElement.style.setProperty('--color-accent', '#2959aa')
      document.documentElement.setAttribute('data-theme', 'light')
    })
    expect(result.current).toBe('41, 89, 170')
  })
})
