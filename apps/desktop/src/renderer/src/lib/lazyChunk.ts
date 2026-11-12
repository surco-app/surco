import { lazy } from 'react'

const loaders: (() => Promise<unknown>)[] = []

export const lazyChunk: typeof lazy = (load) => {
  loaders.push(load)
  return lazy(load)
}

export async function preloadLazy(): Promise<void> {
  for (let loaded = 0; loaded < loaders.length; ) {
    const batch = loaders.slice(loaded)
    loaded = loaders.length
    await Promise.all(batch.map((load) => load()))
  }
}

let idlePreloadScheduled = false

export function preloadLazyWhenIdle(): void {
  if (idlePreloadScheduled) return
  idlePreloadScheduled = true
  const preload = (): void => {
    void preloadLazy().catch(() => {})
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload)
  else setTimeout(preload, 0)
}
