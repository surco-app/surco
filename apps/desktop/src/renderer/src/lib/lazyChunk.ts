import { lazy } from 'react'

const loaders: (() => Promise<unknown>)[] = []

export const lazyChunk: typeof lazy = (load) => {
  let loaded: Awaited<ReturnType<typeof load>> | undefined
  const remember = () =>
    load().then((chunk) => {
      loaded = chunk
      return chunk
    })
  loaders.push(remember)
  return lazy(() => {
    const chunk = loaded
    if (!chunk) return remember()
    // biome-ignore lint/suspicious/noThenProperty: React.lazy renders without suspending only when its thenable settles synchronously
    return { then: (resolve: (value: typeof chunk) => void) => resolve(chunk) } as ReturnType<
      typeof load
    >
  })
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
