// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import LibraryReview from './LibraryReview'
import Spotlight from './Spotlight'
import Walkthrough from './Walkthrough'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

async function renderBelowTheFold(...children: ReturnType<typeof createElement>[]) {
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
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: window.innerHeight + 5000,
  } as DOMRect)
  const i18n = await loadI18n('en')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, ...children))
  })
  return container
}

const SECTIONS =
  '[data-testid^="spotlight-"], [data-testid="library-review"], [data-testid="scene-layout"]'

describe('home sections', () => {
  it('reveal at most one block each, because the scenes already carry their own motion', async () => {
    const container = await renderBelowTheFold(
      createElement(Walkthrough),
      ...(['cues', 'replace', 'sync', 'matching'] as const).map((copy) =>
        createElement(Spotlight, {
          key: copy,
          id: copy,
          view: 'home-cues' as never,
          copy,
          points: ['a'],
          scene: createElement('div'),
        }),
      ),
      createElement(LibraryReview),
    )
    const sections = [...container.querySelectorAll(SECTIONS)]
    expect(sections.length).toBe(8)
    for (const section of sections) {
      expect(section.querySelectorAll('.reveal-init').length).toBeLessThanOrEqual(1)
    }
  })
})
