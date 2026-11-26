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

  function renderWith(nav?: { position: number; count: number; onStep: (d: number) => void }) {
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CoverLightbox src="blob:cover" nav={nav} onClose={onClose} />
      </QueryClientProvider>,
    )
    return onClose
  }

  function press(key: string): boolean {
    let prevented = false
    const appHandler = (e: KeyboardEvent): void => {
      prevented = e.defaultPrevented
    }
    window.addEventListener('keydown', appHandler)
    fireEvent.keyDown(window, { key, cancelable: true })
    window.removeEventListener('keydown', appHandler)
    return prevented
  }

  // With the release's images on offer the DJ flips through them from the keyboard, and the
  // arrow must not also step the track list behind the cover.
  it('steps through the cover choices with the arrow keys and keeps them from the list', () => {
    const onStep = vi.fn()
    const onClose = renderWith({ position: 2, count: 3, onStep })
    expect(press('ArrowLeft')).toBe(true)
    expect(press('ArrowRight')).toBe(true)
    expect(onStep.mock.calls).toEqual([[-1], [1]])
    expect(onClose).not.toHaveBeenCalled()
  })

  // A single cover has nothing to step to; swallowing the arrows would freeze the app's
  // own arrow handling for no reason.
  it('leaves the arrows alone when there is only one cover', () => {
    const errors: unknown[] = []
    const onError = (e: ErrorEvent): void => {
      errors.push(e.error)
      e.preventDefault()
    }
    window.addEventListener('error', onError)
    const onClose = renderWith()
    expect(press('ArrowLeft')).toBe(false)
    expect(press('ArrowRight')).toBe(false)
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets every other key through untouched', () => {
    const onStep = vi.fn()
    const onClose = renderWith({ position: 1, count: 2, onStep })
    expect(press(' ')).toBe(false)
    expect(press('ArrowDown')).toBe(false)
    expect(onStep).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening once the lightbox closes', () => {
    const onStep = vi.fn()
    const onClose = renderWith({ position: 1, count: 2, onStep })
    cleanup()
    press('Escape')
    press('ArrowRight')
    expect(onClose).not.toHaveBeenCalled()
    expect(onStep).not.toHaveBeenCalled()
  })
})
