import { useEffect, useRef } from 'react'

const stops: [number, [number, number, number]][] = [
  [0.0, [21, 22, 30]], [0.16, [31, 35, 53]], [0.32, [36, 54, 110]],
  [0.48, [52, 84, 138]], [0.62, [90, 127, 214]], [0.74, [122, 162, 247]],
  [0.86, [125, 207, 255]], [0.94, [187, 154, 247]], [1.0, [214, 240, 255]]
]

function colormap(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [b, cb] = stops[i + 1]
    if (v <= b) {
      const u = (v - a) / (b - a)
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * u),
        Math.round(ca[1] + (cb[1] - ca[1]) * u),
        Math.round(ca[2] + (cb[2] - ca[2]) * u)
      ]
    }
  }
  return stops[stops.length - 1][1]
}

const fract = (v: number) => v - Math.floor(v)
const noise = (x: number, y: number) => fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453)

function energy(t: number, f: number, suspect: boolean): number {
  const floor = 0.06
  const tilt = Math.exp(-f * 2.1)
  let e = floor + 0.72 * tilt

  const section = 0.62 + 0.38 * Math.sin(t * 5.7 + 0.6) * Math.sin(t * 2.1 + 1.3)
  e *= section

  const break1 = 1 - 0.85 * Math.exp(-(((t - 0.34) / 0.018) ** 2))
  const break2 = 1 - 0.7 * Math.exp(-(((t - 0.71) / 0.012) ** 2))
  e *= break1 * break2

  const beat = fract(t * 24)
  const transient = Math.exp(-((beat / 0.014) ** 2))
  e += transient * (0.5 + 0.4 * tilt)

  let harm = 0
  for (let k = 1; k <= 7; k++) {
    const c = 0.045 * k
    harm += 0.13 * Math.exp(-(((f - c) / 0.009) ** 2)) * (0.55 + 0.45 * Math.sin(t * 9 + k * 1.7))
  }
  e += harm

  e *= 0.8 + 0.32 * noise(t * 680, f * 300)
  e += 0.05 * noise(t * 240 + 11, f * 880)

  if (suspect) {
    const cut = 16 / NYQUIST
    if (f > cut) e *= 0.01 + 0.99 * Math.exp(-(f - cut) * 200)
    if (Math.abs(f - cut) < 0.006) e = Math.max(e, 0.62)
  }
  return Math.max(0, Math.min(1, e))
}

const C = 320
const R = 110

const NYQUIST = 22
const ticks = [20, 15, 10, 5]

export default function Spectrogram({
  suspect = false,
  axis = false
}: {
  suspect?: boolean
  axis?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cw = canvas.width / C
    const ch = canvas.height / R
    for (let cx = 0; cx < C; cx++) {
      for (let cy = 0; cy < R; cy++) {
        const t = cx / (C - 1)
        const f = (R - 1 - cy) / (R - 1)
        const [r, g, b] = colormap(energy(t, f, suspect))
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(cx * cw, cy * ch, cw + 0.6, ch + 0.6)
      }
    }
  }, [suspect])

  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-line/70">
      <canvas ref={ref} width={C * 2} height={R * 2} className="block h-full w-full" />
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px"
        style={{
          animation: 'scan 4.5s linear infinite',
          background: '#7dcfff',
          boxShadow: '0 0 14px 2px rgba(125,207,255,0.6)'
        }}
      />
      {axis && (
        <div className="pointer-events-none absolute inset-y-0 right-0 font-mono text-[9px] text-fg/75">
          {ticks.map((k) => (
            <span
              key={k}
              className="absolute right-1 -translate-y-1/2 rounded-sm bg-bg/55 px-1 leading-none backdrop-blur-sm"
              style={{ top: `${(1 - k / NYQUIST) * 100}%` }}
            >
              {k} kHz
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
