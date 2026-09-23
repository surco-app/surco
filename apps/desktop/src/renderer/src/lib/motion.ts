// The OS-level "reduce motion" request, read at the moment motion is about to start, for
// the motion CSS cannot reach: height tweens and smooth scrolls driven from script. jsdom
// and older runtimes have no matchMedia, and no answer means no request.
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
