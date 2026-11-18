// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import Changelog from './Changelog'
import Faq from './Faq'
import Features from './Features'
import Header from './Header'
import HeroAnchors from './HeroAnchors'
import Lightbox from './Lightbox'
import UseCases from './UseCases'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

async function render(child: ReturnType<typeof createElement>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const i18n = await loadI18n('en', { releases: true })
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, child))
  })
  return container
}

function all(container: HTMLElement, testId: string) {
  const found = [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
  if (found.length === 0) throw new Error(`${testId} is not on screen`)
  return found
}

const PRESS_SCALE = 'active:scale-[0.97]'
const PRESS_TRANSITION = 'transition-[color,background-color,border-color,scale]'

function expectScaleFeedback(container: HTMLElement, testId: string) {
  for (const el of all(container, testId)) {
    expect(el.className, testId).toContain(PRESS_SCALE)
    expect(el.className, testId).toContain(PRESS_TRANSITION)
    expect(el.className, testId).toContain('duration-[160ms]')
  }
}

function expectColourFeedback(container: HTMLElement, testId: string, utility: string) {
  for (const el of all(container, testId)) {
    expect(el.className, testId).toContain(utility)
    expect(el.className, testId).not.toContain('active:scale')
  }
}

describe('taps answer on touch, where hover never fires', () => {
  it('presses the header icon buttons in', async () => {
    const container = await render(createElement(Header))
    expectScaleFeedback(container, 'theme-toggle')
    expectScaleFeedback(container, 'language-menu-toggle')
    expectScaleFeedback(container, 'header-menu-toggle')
  })

  it('recolours the mobile menu links without moving them', async () => {
    const container = await render(createElement(Header))
    for (const id of [
      'header-mobile-features',
      'header-mobile-guide',
      'header-mobile-use-cases',
      'header-mobile-changelog',
    ])
      expectColourFeedback(container, id, 'active:text-fg')
  })

  it('presses the hero anchors in', async () => {
    const container = await render(createElement(HeroAnchors))
    for (const el of all(container, 'hero-anchors')) expect(el).toBeTruthy()
    for (const key of ['quality', 'tag', 'export'])
      expectScaleFeedback(container, `hero-anchor-${key}`)
  })

  it('recolours the features index links without moving them', async () => {
    const container = await render(createElement(Features))
    expectColourFeedback(container, 'features-index-link', 'active:border-blue')
  })

  it('presses the use-case source chips in', async () => {
    const container = await render(createElement(UseCases))
    expectScaleFeedback(container, 'use-case-source')
  })

  it('presses the lightbox close button in without a catch-all transition', async () => {
    const container = await render(
      createElement(Lightbox, {
        open: true,
        src: null,
        alt: 'shot',
        closeLabel: 'Close',
        onClose: () => {},
      }),
    )
    expectScaleFeedback(container, 'lightbox-close')
    for (const el of all(container, 'lightbox-close'))
      expect(el.className.split(/\s+/)).not.toContain('transition')
  })

  it('recolours the FAQ questions without moving them', async () => {
    const container = await render(createElement(Faq))
    expectColourFeedback(container, 'faq-question', 'active:text-blue')
  })

  it('recolours the older changelog rows without moving them', async () => {
    const container = await render(createElement(Changelog))
    expectColourFeedback(container, 'changelog-older-summary', 'active:text-blue')
  })
})
