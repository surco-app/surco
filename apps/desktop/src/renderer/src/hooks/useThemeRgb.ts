import { useEffect, useState } from 'react'
import { parseColor } from '../lib/spectrumColors'

function read(token: string): string {
  return parseColor(getComputedStyle(document.documentElement).getPropertyValue(token)).join(', ')
}

// A theme token as literal "r, g, b" channels for a canvas, which can't read CSS variables.
// The theme is written one-way to <html data-theme> with no React store (same situation as
// useSpectrumDuotone), so the token is re-read when that attribute changes.
export function useThemeRgb(token: string): string {
  const [rgb, setRgb] = useState(() => read(token))
  useEffect(() => {
    const update = (): void => setRgb(read(token))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    update()
    return () => observer.disconnect()
  }, [token])
  return rgb
}
