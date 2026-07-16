import type React from 'react'
import { WaveformSkeleton } from './WaveformSkeleton'

// The placeholder for Silence Trim's two-lane layout while the wave decodes. It mirrors
// the real thing — a START and an END lane side by side (flex gap-8), each with its own
// control row (label + nudge/time/nudge + audition/clear + zoom, as greyed pills) above a
// fixed-height wave — so the lanes swap in without a layout jump. The single-block skeleton
// it replaces looked nothing like the split view it stood in for.

// A greyed stand-in for one of the lane's h-7 controls, sized to the real button widths.
function CtrlPill({ w }: { w: string }): React.JSX.Element {
  return <span className={`h-7 ${w} shrink-0 animate-pulse rounded-md bg-[var(--color-panel-2)]`} />
}

function LaneSkeleton({ side }: { side: 'start' | 'end' }): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      {/* The control row: a label on the left, then the nudge/time/nudge cluster and the
          audition/clear/zoom controls — the same shapes the real lane toolbar carries. */}
      <div className="mb-1 flex flex-nowrap items-center gap-1.5">
        <span className="h-2.5 w-10 animate-pulse rounded bg-[var(--color-panel-2)]" />
        <span className="flex-1" />
        <CtrlPill w="w-5" />
        <CtrlPill w="w-16" />
        <CtrlPill w="w-5" />
        <CtrlPill w="w-7" />
        <CtrlPill w="w-7" />
        <CtrlPill w="w-14" />
      </div>
      <div className="relative h-24">
        <WaveformSkeleton testid={`trim-loading-${side}`} />
      </div>
    </div>
  )
}

export function TrimSkeleton(): React.JSX.Element {
  return (
    <div data-testid="trim-skeleton" className="flex gap-8">
      <LaneSkeleton side="start" />
      <LaneSkeleton side="end" />
    </div>
  )
}
