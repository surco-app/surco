import type React from 'react'
import { COVER_SIZE, ROW_WAVE_HEIGHT, rowBox, rowTextHeight } from './ListRow'

const TITLE_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '43%', '58%', '51%']
const ARTIST_WIDTHS = ['38%', '29%', '44%', '33%', '25%', '40%', '31%', '36%']
const BAR = 'rounded bg-[var(--color-panel-2)]'

export function TrackListSkeleton({
  testid,
  label,
  showWaves,
}: {
  testid: string
  label: string
  showWaves: boolean
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
          className={rowBox(!showWaves)}
          style={{ opacity: 1 - i * 0.09 }}
        >
          <span
            className={`${COVER_SIZE[showWaves ? 'large' : 'medium']} shrink-0 rounded-md ${BAR}`}
          />
          <span
            className={`ml-0.5 flex min-w-0 flex-1 flex-col justify-between ${rowTextHeight(showWaves)}`}
          >
            <span className="flex flex-col gap-px">
              <span className="flex h-[18px] items-center gap-2">
                <span className={`h-2.5 ${BAR}`} style={{ width: title }} />
                <span className={`ml-auto h-2 w-[34px] ${BAR}`} />
              </span>
              <span className="flex h-4 items-center">
                <span className={`h-2 ${BAR}`} style={{ width: ARTIST_WIDTHS[i] }} />
              </span>
            </span>
            {showWaves && (
              <span
                data-testid="track-row-skeleton-wave"
                className={`${ROW_WAVE_HEIGHT} w-full opacity-60 ${BAR}`}
              />
            )}
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
