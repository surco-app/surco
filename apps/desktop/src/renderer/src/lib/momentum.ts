// Momentum for a view flung by hand, on Apple's scroll deceleration: the speed keeps 0.998 of
// itself every millisecond, so a flick coasts on and eases to a rest the way a scroll view does.
export const DECELERATION_PER_MS = 0.998

// Only the end of a drag says where it was going, and a hand that paused before letting go
// meant to stay put.
const RELEASE_WINDOW_MS = 80
const STILL_BEFORE_RELEASE_MS = 50
const MIN_MEASURED_MS = 10

export interface TrailPoint {
  at: number
  t: number
}

export function releaseVelocity(trail: TrailPoint[], now: number): number {
  const last = trail.at(-1)
  if (!last || now - last.t > STILL_BEFORE_RELEASE_MS) return 0
  const first = trail.find((p) => last.t - p.t <= RELEASE_WINDOW_MS) ?? last
  const dt = last.t - first.t
  return dt < MIN_MEASURED_MS ? 0 : (last.at - first.at) / dt
}

export function coastDistance(velocity: number): number {
  return (velocity * DECELERATION_PER_MS) / (1 - DECELERATION_PER_MS)
}
