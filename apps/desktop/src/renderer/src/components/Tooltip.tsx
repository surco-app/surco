import type React from 'react'

// Themed hover tooltip, dropped in as the last child of a `group relative` trigger so it
// replaces the slow, unstyled native title. It drops below the trigger (the bars and
// toolbars that use it sit near the top of their panels) and fades in on hover. `align`
// anchors it under the trigger; pick `end` for triggers near the right edge so a wide
// label doesn't overflow the panel.
const ALIGN: Record<'center' | 'start' | 'end', string> = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0',
}

export function Tooltip({
  label,
  align = 'center',
}: {
  label: string
  align?: 'center' | 'start' | 'end'
}): React.JSX.Element {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-30 mt-1.5 max-w-[14rem] translate-y-0.5 rounded-md bg-[var(--color-panel-2)] px-2 py-1 text-left text-xs font-normal text-fg opacity-0 shadow-md ring-1 ring-[var(--color-line-strong)] transition-[opacity,transform] group-hover:translate-y-0 group-hover:opacity-100 ${ALIGN[align]}`}
    >
      {label}
    </span>
  )
}
