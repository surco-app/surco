import type React from 'react'
import { useEffect, useRef } from 'react'

// A one-shot canvas confetti burst for the donate nudge: two volleys fired from the
// bottom-left and bottom-right corners, each aimed up and inward so the streams cross
// past the top-centre before gravity pulls them down. No library — a handful of
// particles on a pointer-events-none overlay, torn down when they settle. Honors
// prefers-reduced-motion by rendering nothing, so the celebration never fights the OS.
const PER_CORNER = 70
const GRAVITY = 0.25
const DRAG = 0.994

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rot: number
  vrot: number
  life: number
}

// A palette built around Surco's accent so the confetti reads as the app's own colour, not
// a generic party mix: the live --color-accent plus a few luminance-shifted siblings. Falls
// back to the dark-theme accent if the variable can't be read (e.g. jsdom).
function themePalette(): string[] {
  const accent =
    (typeof getComputedStyle !== 'undefined' &&
      getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()) ||
    '#7aa2f7'
  return [
    accent,
    `color-mix(in srgb, ${accent} 65%, white)`,
    `color-mix(in srgb, ${accent} 70%, black)`,
    `color-mix(in srgb, ${accent} 55%, #7dcfff)`,
    `color-mix(in srgb, ${accent} 55%, #bb9af7)`,
  ]
}

function spawn(width: number, height: number): Particle[] {
  const out: Particle[] = []
  const colors = themePalette()
  // Scale launch speed to the window height so the streams just clear the top half on any
  // screen (max rise ≈ vy² / 2·gravity) — enough to cross near the top-centre, not shoot off
  // the top. A fixed speed either fell short or overshot depending on the window size.
  const power = Math.max(16, Math.sqrt(height) * 0.7)
  // Left corner aims right-and-up, right corner aims left-and-up; the horizontal reach is
  // scaled to the window so both streams meet around the top-centre on any screen size.
  for (const corner of [-1, 1] as const) {
    const originX = corner === -1 ? 0 : width
    for (let i = 0; i < PER_CORNER; i++) {
      const speed = power * (0.85 + Math.random() * 0.3)
      // ~50–75° above the horizon, tilted inward toward the opposite side — steeper than
      // before so the burst climbs high rather than spraying sideways and dropping early.
      const angle = (50 + Math.random() * 25) * (Math.PI / 180)
      out.push({
        x: originX,
        y: height,
        vx: -corner * Math.cos(angle) * speed * (0.7 + (width / height) * 0.3),
        vy: -Math.sin(angle) * speed,
        size: 6 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        life: 0,
      })
    }
  }
  return out
}

export function Confetti(): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width
    canvas.height = height
    const particles = spawn(width, height)
    let raf = 0

    function frame(): void {
      if (!ctx) return
      ctx.clearRect(0, 0, width, height)
      let alive = false
      for (const p of particles) {
        p.vx *= DRAG
        p.vy = p.vy * DRAG + GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vrot
        p.life += 1
        // Hold full opacity through the climb and only fade the tail end of the fall, so a
        // high-flying piece never blinks out mid-air; the window matches the arc's duration.
        const alpha = Math.max(0, Math.min(1, (195 - p.life) / 55))
        if (alpha <= 0 || p.y > height + 40) continue
        alive = true
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }
      if (alive) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  if (reduced) return null
  return (
    <canvas
      ref={canvasRef}
      data-testid="confetti"
      className="pointer-events-none fixed inset-0 z-[60]"
    />
  )
}
