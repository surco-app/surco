// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Reveal from './Reveal'

let root: Root | null = null
let observers: {
  options: IntersectionObserverInit | undefined
  fire: () => void
}[] = []

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  observers = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function mount(top: number): Promise<HTMLElement> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        private readonly onChange: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        observers.push({
          options,
          fire: () =>
            this.onChange(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
        })
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
  } as DOMRect)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(
      createElement(Reveal, null, createElement('p', { 'data-testid': 'child' }, 'hola')),
    )
  })
  return host.firstElementChild as HTMLElement
}

describe('Reveal', () => {
  it('ships visible in the prerendered HTML so no-JS readers see the content', () => {
    const html = renderToString(createElement(Reveal, null, 'hola'))
    expect(html).not.toContain('reveal-init')
  })

  it('hides a block below the fold after mount and shows it when the observer fires', async () => {
    const el = await mount(window.innerHeight + 500)
    expect(el.classList.contains('reveal-init')).toBe(true)
    expect(el.classList.contains('reveal-in')).toBe(false)
    await act(async () => observers[0].fire())
    expect(el.classList.contains('reveal-in')).toBe(true)
  })

  it('never hides a block that is already on screen', async () => {
    const el = await mount(100)
    expect(el.classList.contains('reveal-init')).toBe(false)
  })

  it('observes with threshold 0 so a block taller than the viewport still reveals', async () => {
    await mount(window.innerHeight + 500)
    expect(observers[0].options?.threshold).toBe(0)
  })
})
