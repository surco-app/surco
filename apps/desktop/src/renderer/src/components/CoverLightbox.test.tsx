// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { CoverLightbox } from './CoverLightbox'

afterEach(cleanup)

describe('CoverLightbox', () => {
  // App's Escape handler is registered on window before the lightbox mounts and clears the
  // selection unless the press was already handled. Left unclaimed, one Escape closed the
  // cover AND unmounted the editor the user was looking at.
  it('claims Escape before the app-wide handler so only the lightbox closes', () => {
    const seen: boolean[] = []
    const appEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') seen.push(e.defaultPrevented)
    }
    window.addEventListener('keydown', appEscape)
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CoverLightbox src="blob:cover" onClose={onClose} />
      </QueryClientProvider>,
    )
    fireEvent.keyDown(window, { key: 'Escape', cancelable: true })
    window.removeEventListener('keydown', appEscape)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([true])
  })
})
