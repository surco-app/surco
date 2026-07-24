import { vi } from 'vitest'

// jsdom does not implement HTMLCanvasElement.prototype.getContext and throws a
// noisy "Not implemented" error whenever a component mounts a canvas. Every
// canvas consumer in the renderer already guards on a null context, so returning
// null is a faithful stub that keeps the tests exercising real code paths.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext
}

// Vitest's jsdom environment only copies window properties it already knows the
// name of onto the test global, and its allowlist predates Node's own (broken
// without --localstorage-file) global `localStorage`. That Node global shadows
// jsdom's real, working implementation, so `window.localStorage` resolves to
// undefined in every test unless restored here from the underlying JSDOM instance.
// biome-ignore lint/suspicious/noExplicitAny: reaching past the typed globals for the environment-internal jsdom handle
const jsdomWindow = (globalThis as any).jsdom?.window
if (jsdomWindow?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomWindow.localStorage,
    configurable: true,
  })
}
