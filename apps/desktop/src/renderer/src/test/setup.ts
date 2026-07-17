import { vi } from 'vitest'

// jsdom does not implement HTMLCanvasElement.prototype.getContext and throws a
// noisy "Not implemented" error whenever a component mounts a canvas. Every
// canvas consumer in the renderer already guards on a null context, so returning
// null is a faithful stub that keeps the tests exercising real code paths.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext
}
