import { useQuery } from '@tanstack/react-query'
import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { LimiterGlimpse as Glimpse } from '../../../shared/types'
import { useThemeRgb } from '../hooks/useThemeRgb'

type Side = 'worse' | 'better'

const HEIGHT = 96

// The better copy goes underneath, so only what it has beyond the worse copy shows: the hits
// the limiter took away. One scale for both whatever is shown, so hiding a copy never makes
// the other look taller.
export function drawGlimpse(
  ctx: CanvasRenderingContext2D,
  glimpse: Glimpse,
  show: Record<Side, boolean>,
  colors: Record<Side, string>,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height)
  const peak = Math.max(...glimpse.worse.map(Math.abs), ...glimpse.better.map(Math.abs))
  if (peak === 0) return
  const mid = height / 2
  const scale = (mid - 2) / peak
  for (const side of ['better', 'worse'] as const) {
    if (!show[side]) continue
    const pairs = glimpse[side]
    const columns = pairs.length / 2
    const step = width / columns
    ctx.fillStyle = colors[side]
    for (let c = 0; c < columns; c++) {
      const lo = pairs[2 * c]
      const hi = pairs[2 * c + 1]
      ctx.fillRect(c * step, mid - hi * scale, Math.max(1, step), Math.max(1, (hi - lo) * scale))
    }
  }
  // The worse copy's ceiling, kept with that copy hidden so the better one reads against it.
  const ceiling = Math.max(...glimpse.worse.map(Math.abs)) * scale
  ctx.strokeStyle = colors.worse
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  for (const y of [mid - ceiling, mid + ceiling]) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

export function LimiterGlimpse({
  worsePath,
  betterPath,
  sampleRate,
  layers,
}: {
  worsePath: string
  betterPath: string
  sampleRate: number
  // Legend order and names: this file first, as in the table below.
  layers: readonly { side: Side; label: string }[]
}): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ['limiterGlimpse', worsePath, betterPath, sampleRate],
    queryFn: () => window.api.limiterGlimpse(worsePath, betterPath, sampleRate),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [show, setShow] = useState<Record<Side, boolean>>({ worse: true, better: true })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const good = useThemeRgb('--color-good')
  const warn = useThemeRgb('--color-warn')
  const colors = { better: `rgb(${good})`, worse: `rgb(${warn})` }
  const glimpse = query.data

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !glimpse) return
    const paint = (): void => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      canvas.width = width * dpr
      canvas.height = HEIGHT * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawGlimpse(
        ctx,
        glimpse,
        show,
        { better: `rgb(${good})`, worse: `rgb(${warn})` },
        width,
        HEIGHT,
      )
    }
    paint()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [glimpse, show, good, warn])

  if (query.isPending) {
    return (
      <div
        data-testid="glimpse-placeholder"
        className="mt-2 rounded-lg bg-[var(--color-field)]"
        style={{ height: HEIGHT + 30 }}
      />
    )
  }
  if (!glimpse) return null
  return (
    <div
      data-testid="limiter-glimpse"
      className="mt-2 rounded-lg bg-[var(--color-field)] px-3 py-2"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: HEIGHT }} />
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {layers.map(({ side, label }) => (
          <button
            key={side}
            type="button"
            data-testid={`glimpse-toggle-${side}`}
            aria-pressed={show[side]}
            onClick={() => setShow((s) => ({ ...s, [side]: !s[side] }))}
            className={`press flex items-center gap-1.5 rounded text-xs ${show[side] ? 'text-fg-dim hover:text-fg-muted' : 'text-fg-dim/50 line-through'}`}
          >
            <span
              aria-hidden="true"
              className="h-0.5 w-2.5 rounded-full"
              style={{ background: colors[side], opacity: show[side] ? 1 : 0.4 }}
            />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
