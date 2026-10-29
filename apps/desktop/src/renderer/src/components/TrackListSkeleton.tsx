import type React from 'react'

const TITLE_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '43%', '58%', '51%']
const ARTIST_WIDTHS = ['38%', '29%', '44%', '33%', '25%', '40%', '31%', '36%']
const BAR = 'rounded bg-[var(--color-panel-2)]'

export function TrackListSkeleton({
  testid,
  label,
}: {
  testid: string
  label: string
}): React.JSX.Element {
  return (
    <div
      data-testid={testid}
      role="status"
      className="relative flex flex-col gap-0.5 overflow-hidden p-2"
    >
      <span className="sr-only">{label}</span>
      {TITLE_WIDTHS.map((title, i) => (
        <div
          key={title + ARTIST_WIDTHS[i]}
          data-testid="track-row-skeleton"
          aria-hidden="true"
          className="flex items-center gap-2.5 px-2.5 py-2"
          style={{ opacity: 1 - i * 0.09 }}
        >
          <span className={`h-16 w-16 shrink-0 rounded-md ${BAR}`} />
          <span className="ml-0.5 flex h-16 min-w-0 flex-1 flex-col justify-between">
            <span className="flex flex-col gap-px">
              <span className="flex h-[18px] items-center gap-2">
                <span className={`h-2.5 ${BAR}`} style={{ width: title }} />
                <span className={`ml-auto h-2 w-[34px] ${BAR}`} />
              </span>
              <span className="flex h-4 items-center">
                <span className={`h-2 ${BAR}`} style={{ width: ARTIST_WIDTHS[i] }} />
              </span>
            </span>
            <span className={`h-4 w-full opacity-60 ${BAR}`} />
          </span>
        </div>
      ))}
      <span
        aria-hidden="true"
        className="spectrum-scan pointer-events-none absolute inset-y-0 left-0 w-1/3"
      />
    </div>
  )
}
