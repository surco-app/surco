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
