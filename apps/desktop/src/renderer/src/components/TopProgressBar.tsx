import type React from 'react'

interface Props {
  // 0..1 for a known fraction of work done, or null for an indeterminate run (an import
  // with no fixed total) that animates a sliding segment instead of filling.
  fraction: number | null
}

// A slim, NProgress-style bar for long background sweeps (analyze, auto-match, batch
// convert, import). Rendered at the bottom edge of its positioned parent — the toolbar —
// so it rides the divider line above the list. pointer-events-none so it never blocks the
// controls underneath it.
export function TopProgressBar({ fraction }: Props): React.JSX.Element {
  const determinate = fraction !== null
  return (
    <div
      data-testid="top-progress"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 h-0.5 overflow-hidden"
    >
      <div
        className={`h-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)] ${
          determinate ? 'transition-[width] duration-300 ease-out' : 'w-1/3 animate-top-progress'
        }`}
        style={determinate ? { width: `${Math.round((fraction ?? 0) * 100)}%` } : undefined}
      />
    </div>
  )
}
