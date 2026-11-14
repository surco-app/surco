// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadI18n } from '../i18n'
import Header from './Header'

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.replaceChildren()
})

async function renderOfferedHeader(): Promise<HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const i18n = await loadI18n('es')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, createElement(Header)))
  })
  if (!container.querySelector('[data-testid="language-offer"]'))
    throw new Error('the language offer is not on screen')
  return container
}

function click(container: HTMLElement, testId: string) {
  const el = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`${testId} is not on screen`)
  return act(async () => el.click())
}

function pressEscape() {
  return act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
}

const offer = (container: HTMLElement) => container.querySelector('[data-testid="language-offer"]')

describe('language offer and Escape', () => {
  it('lets Escape close the mobile menu without throwing away the offer the visitor never saw answered', async () => {
    const container = await renderOfferedHeader()
    await click(container, 'header-menu-toggle')
    await pressEscape()
    expect(localStorage.getItem('surco_lang')).toBeNull()
    expect(offer(container)).not.toBeNull()
  })

  it('lets Escape close the language menu without silencing the offer for good', async () => {
    const container = await renderOfferedHeader()
    await click(container, 'language-menu-toggle')
    await pressEscape()
    expect(localStorage.getItem('surco_lang')).toBeNull()
    expect(offer(container)).not.toBeNull()
  })

  it('hides the offer while the language menu is open so its edges do not stick out around the menu', async () => {
    const container = await renderOfferedHeader()
    await click(container, 'language-menu-toggle')
    expect(offer(container)).toBeNull()
  })

  it('still dismisses the offer with Escape when it is the thing on screen', async () => {
    const container = await renderOfferedHeader()
    await pressEscape()
    expect(localStorage.getItem('surco_lang')).toBe('es')
    expect(offer(container)).toBeNull()
  })
})
