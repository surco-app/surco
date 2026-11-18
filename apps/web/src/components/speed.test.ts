// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { type Language, loadI18n } from '../i18n'
import Speed from './Speed'

let root: Root | null = null
let observers: { callback: (entries: { isIntersecting: boolean }[]) => void; target: Element }[] =
  []

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  observers = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

type Position = 'below' | 'inView'

async function renderSpeed(language: Language, reducedMotion = false, position: Position = 'below') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      callback: (entries: { isIntersecting: boolean }[]) => void
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        this.callback = callback
      }
      observe(target: Element) {
        observers.push({ callback: this.callback, target })
      }
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: position === 'below' ? window.innerHeight + 5000 : 100,
  } as DOMRect)
  const i18n = await loadI18n(language)
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => {
    root = createRoot(container)
    root.render(createElement(I18nextProvider, { i18n }, createElement(Speed)))
  })
  return container
}

const texts = (container: ParentNode, testId: string) =>
  [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)].map(
    (el) => el.textContent,
  )

const values = (container: ParentNode) => texts(container, 'speed-value')

const FINALS = ['44', '25.000', '5,3']

async function arriveAndCount(container: HTMLElement, figure: number) {
  const target = container.querySelectorAll('[data-testid="speed-figure"]')[figure]
  const observer = observers.find((entry) => entry.target === target)
  let step: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    step = callback
    return 1
  })
  await act(async () => observer?.callback([{ isIntersecting: true }]))
  await act(async () => step?.(performance.now() + 600))
}

describe('speed section', () => {
  it('shows the final figures and never starts a count when the visitor asked for reduced motion', async () => {
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const container = await renderSpeed('es', true)
    const figures = [...container.querySelectorAll('[data-testid="speed-figure"]')]
    const watchingFigures = observers.filter((entry) =>
      figures.some((figure) => figure === entry.target || figure.contains(entry.target)),
    )
    expect(values(container)).toEqual(FINALS)
    expect(watchingFigures).toEqual([])
    expect(frame).not.toHaveBeenCalled()
  })

  it('holds figures that are still below the screen at zero, so they can count when they arrive', async () => {
    const container = await renderSpeed('es')
    expect(values(container)).toEqual(['0', '0', '0,0'])
  })

  it('keeps the value of a figure already in view, so nobody watches it fall to zero', async () => {
    const container = await renderSpeed('es', false, 'inView')
    expect(values(container)).toEqual(FINALS)
    await arriveAndCount(container, 0)
    expect(values(container)).toEqual(FINALS)
  })

  it('counts each figure only when it arrives, so a stacked phone layout never finishes off screen', async () => {
    const container = await renderSpeed('es')
    await arriveAndCount(container, 0)
    const [first, second, third] = values(container)
    expect(Number(first)).toBeGreaterThan(0)
    expect(Number(first)).toBeLessThanOrEqual(44)
    expect(second).toBe('0')
    expect(third).toBe('0,0')
  })

  it('reserves the width of each final figure with an invisible copy, so nothing shifts while it counts', async () => {
    const container = await renderSpeed('es')
    expect(texts(container, 'speed-size')).toEqual(FINALS)
    await arriveAndCount(container, 0)
    expect(texts(container, 'speed-size')).toEqual(FINALS)
  })

  it('tells assistive technology the final figure and unit, never the counting number', async () => {
    const container = await renderSpeed('es')
    expect(texts(container, 'speed-spoken')).toEqual(['44 ms', '25.000', '5,3 s'])
    for (const value of container.querySelectorAll('[data-testid="speed-value"]')) {
      expect(value.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('writes the figures with the separators of the page language', async () => {
    const container = await renderSpeed('en')
    expect(texts(container, 'speed-size')).toEqual(['44', '25,000', '5.3'])
  })

  it('prerenders the final figures, so the static page never claims zero', async () => {
    const i18n = await loadI18n('es')
    const html = renderToString(createElement(I18nextProvider, { i18n }, createElement(Speed)))
    const holder = document.createElement('div')
    holder.innerHTML = html
    expect(values(holder)).toEqual(FINALS)
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
