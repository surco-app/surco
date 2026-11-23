import { useEffect } from 'react'

export function useZoomFit(): void {
  useEffect(() => {
    let query: MediaQueryList | null = null
    const watch = (): void => {
      window.api.checkZoom()
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      query.addEventListener('change', watch, { once: true })
    }
    watch()
    return () => query?.removeEventListener('change', watch)
  }, [])
}
