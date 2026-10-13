import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom does not implement HTMLCanvasElement.prototype.getContext and throws a
// noisy "Not implemented" error whenever a component mounts a canvas. Every
// canvas consumer in the renderer already guards on a null context, so returning
// null is a faithful stub that keeps the tests exercising real code paths.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as typeof HTMLCanvasElement.prototype.getContext
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

// Testing Library unmounts after each test on its own only when afterEach is a global,
// and this suite runs without globals. Without it a rendered tree outlives its test and
// its file: a quality sweep still running when the file's jsdom is torn down sets state
// on a window that no longer exists, and the run fails with no test red.
afterEach(cleanup)
