import { barsPath } from '../lib/envelope'
import { HERO_ENVELOPE } from '../lib/waveforms'

const D = barsPath(HERO_ENVELOPE, 40)

// A strip of the real track's waveform, sweeping in on load. It sits inside the app
// window's frame rather than floating on its own, so it reads as part of the product
// instead of decoration next to it.
//
// The sweep is a pure CSS animation — no React state, no effect. A JS-driven reveal
// would leave the wave hidden whenever the effect didn't run, and the graphic matters
// more than the flourish. The reduced-motion block in index.css collapses the
// duration so it lands opened instantly.
export default function HeroWave({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none ${className}`}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="block size-full">
        <title>Forma de onda de una pista</title>
        <defs>
          <linearGradient id="surco-hero-wave" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#7aa2f7" stopOpacity="0.22" />
            <stop offset="34%" stopColor="#7aa2f7" stopOpacity="0.72" />
            <stop offset="68%" stopColor="#7dcfff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#bb9af7" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <path
          d={D}
          fill="url(#surco-hero-wave)"
          style={{ animation: 'wave-sweep 1500ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
        />
      </svg>
    </div>
  )
}
