// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { type Language, loadI18n } from '../i18n'
import Speed from './Speed'

let root: Root | null = null
let intersect: ((entries: { isIntersecting: boolean }[]) => void) | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  intersect = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function renderSpeed(language: Language, reducedMotion = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener() {},
    removeEventListener() {},
  }))
  const i18n = await loadI18n(language)
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, createElement(Speed)))
  })
  return container
}

const values = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-testid="speed-value"]')].map(
    (el) => el.textContent,
  )

const widths = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-testid="speed-value"]')].map(
    (el) => el.style.width,
  )

async function startCount() {
  let ran = false
  const frame = vi.fn((callback: FrameRequestCallback) => {
    if (!ran) {
      ran = true
      callback(performance.now() + 1)
    }
    return 1
  })
  vi.stubGlobal('requestAnimationFrame', frame)
  await act(async () => intersect?.([{ isIntersecting: true }]))
}

describe('speed section', () => {
  it('shows the measured figures before the count starts, so the prerendered page never claims zero', async () => {
    const container = await renderSpeed('es')
    expect(values(container)).toEqual(['44', '25.000', '5,3'])
  })

  it('shows the final figures and never counts when the visitor asked for reduced motion', async () => {
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const container = await renderSpeed('es', true)
    expect(frame).not.toHaveBeenCalled()
    expect(values(container)).toEqual(['44', '25.000', '5,3'])
  })

  it('counts from zero once the section scrolls into view', async () => {
    const container = await renderSpeed('es')
    await startCount()
    expect(values(container)).not.toEqual(['44', '25.000', '5,3'])
  })

  it('reserves the final width of each figure, so nothing shifts while it counts', async () => {
    const container = await renderSpeed('es')
    const finals = values(container).map((text) => `${text?.length}ch`)
    expect(widths(container)).toEqual(finals)
    await startCount()
    expect(widths(container)).toEqual(finals)
  })

  it('writes the figures with the separators of the page language', async () => {
    const container = await renderSpeed('en')
    expect(values(container)).toEqual(['44', '25,000', '5.3'])
  })

  it('sits between matching and the library review, after the features it speaks for', async () => {
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
      root.render(createElement(I18nextProvider, { i18n }, createElement(App)))
    })
    const order = [...container.querySelectorAll('[data-testid]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => ['spotlight-matching', 'speed', 'library-review'].includes(id ?? ''))
    expect(order).toEqual(['spotlight-matching', 'speed', 'library-review'])
  })
})
