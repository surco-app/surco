// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import HeroApp from './HeroApp'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function renderPlayingHero(play: () => Promise<void>): Promise<HTMLButtonElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly onChange: IntersectionObserverCallback) {}
      observe() {
        this.onChange(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
      disconnect() {}
    },
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const i18n = await loadI18n('en')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, createElement(HeroApp, { video: true })))
  })
  const button = container.querySelector<HTMLButtonElement>('[data-testid="hero-video-pause"]')
  if (!button) throw new Error('the pause button is not on screen')
  return button
}

describe('hero video pause', () => {
  it('stays paused when the browser refuses to resume, so the button never claims a loop that is not playing', async () => {
    const play = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined)
    const button = await renderPlayingHero(play)
    await act(async () => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
    await act(async () => button.click())
    expect(play).toHaveBeenCalledTimes(2)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('resumes when the browser lets it play again', async () => {
    const play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const button = await renderPlayingHero(play)
    await act(async () => button.click())
    await act(async () => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })
})
