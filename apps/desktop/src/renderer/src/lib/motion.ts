// The OS-level "reduce motion" request, read at the moment motion is about to start, for
// the motion CSS cannot reach: height tweens and smooth scrolls driven from script. jsdom
// and older runtimes have no matchMedia, and no answer means no request.
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// For scrollTo / scrollIntoView: glide by default, jump when motion is to be reduced.
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

const PANEL_FALLBACK_MS = 240
const STANDARD_FALLBACK = 'cubic-bezier(0.2, 0, 0, 1)'

function rootToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function panelDurationMs(): number {
  const token = rootToken('--duration-panel')
  return Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || PANEL_FALLBACK_MS
}

export function standardEasing(): string {
  return rootToken('--ease-standard') || STANDARD_FALLBACK
}
