// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, type ComponentProps, createElement } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
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

const eagerReveal = () =>
  createElement(Reveal, { eager: true, delay: 150 } as ComponentProps<typeof Reveal>, 'hola')

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

  it('renders an eager block with its entrance delay in the prerendered HTML and never as revealed', () => {
    const html = renderToString(eagerReveal())
    expect(html).toContain('reveal-eager')
    expect(html).toContain('animation-delay:150ms')
    expect(html).not.toContain('reveal-in')
  })

  it('leaves the class list of an eager block untouched after mount so hydration cannot restart the entrance', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div')
    host.innerHTML = renderToString(eagerReveal())
    document.body.append(host)
    const el = host.firstElementChild as HTMLElement
    const before = el.className
    await act(async () => {
      root = hydrateRoot(host, eagerReveal())
    })
    expect(el.className).toBe(before)
    expect(el.classList.contains('reveal-in')).toBe(false)
  })

  it('animates only transform in the eager keyframe so the hero text stays opaque for LCP', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const frames = /@keyframes reveal-eager\s*\{([\s\S]*?\n\})/.exec(css)?.[1] ?? ''
    expect(frames).toContain('transform')
    expect(frames).not.toContain('opacity')
  })
})
