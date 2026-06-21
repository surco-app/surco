import { useEffect, useState } from 'react'
import { parseColor, type Ramp, rampTableValues } from '../lib/spectrumColors'

// Silence → mid → loud. The panel token lets a quiet/black pixel blend into the surrounding
// panel, the accent carries the Tokyo Night blue through the mids, and warn lifts loud
// content to the signature yellow. Both flip with the theme, so the light theme gets a
// light floor with dark blue/amber peaks instead of a navy slab.
const STOP_VARS = ['--color-panel', '--color-accent', '--color-warn'] as const

function readRamp(): Ramp {
  const cs = getComputedStyle(document.documentElement)
  return rampTableValues(STOP_VARS.map((v) => parseColor(cs.getPropertyValue(v))))
}

// The theme is written one-way to <html data-theme>; there is no React store for it, so we
// observe the attribute and re-read the tokens to re-tint the image when it changes.
export function useSpectrumDuotone(): Ramp {
  const [ramp, setRamp] = useState<Ramp>(readRamp)
  useEffect(() => {
    const update = (): void => setRamp(readRamp())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    update()
    return () => observer.disconnect()
  }, [])
  return ramp
}
