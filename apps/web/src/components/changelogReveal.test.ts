// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import Changelog from './Changelog'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

describe('changelog older releases', () => {
  it('are never hidden by a reveal, since a block taller than the screen could stay invisible', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 5000,
    } as DOMRect)
    const i18n = await loadI18n('en', { releases: true })
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(I18nextProvider, { i18n }, createElement(Changelog)))
    })
    const older = container.querySelector('[data-testid="changelog-older"]')
    expect(older?.querySelectorAll('details').length).toBeGreaterThan(6)
    expect(older?.closest('.reveal-init')).toBeNull()
  })

  it('keeps the heading pinned beside the list on desktop', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const i18n = await loadI18n('en', { releases: true })
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () => {
      root = createRoot(container)
      root.render(createElement(I18nextProvider, { i18n }, createElement(Changelog)))
    })
    const side = container.querySelector('[data-testid="changelog-older-side"]')
    expect(side?.className).toContain('lg:sticky')
  })
})
