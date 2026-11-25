import type React from 'react'
import { FILTER_BAR_BOX } from './FilterBar'
import { COVER_SIZE, ROW_WAVE_HEIGHT, rowBox, rowTextHeight } from './ListRow'
import { LOCATION_BOX, SEARCH_ROW } from './TrackListHeader'

const TITLE_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '43%', '58%', '51%']
const ARTIST_WIDTHS = ['38%', '29%', '44%', '33%', '25%', '40%', '31%', '36%']
const BAR = 'rounded bg-[var(--color-panel-2)]'

export function TrackListSkeleton({
  testid,
  label,
  showWaves,
  showLocation,
}: {
  testid: string
  label: string
  showWaves: boolean
  showLocation: boolean
}): React.JSX.Element {
  return (
    <div data-testid={testid} role="status" className="relative overflow-hidden">
      <span className="sr-only">{label}</span>
      <div data-testid="track-list-header-skeleton" aria-hidden="true">
        {showLocation && (
          <span data-testid="track-list-location-skeleton" className={`${LOCATION_BOX} px-1.5`}>
            <span className="flex h-4 items-center">
              <span className={`h-2 w-32 ${BAR}`} />
            </span>
          </span>
        )}
        <div className={SEARCH_ROW}>
          <span className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-[var(--color-panel-2)]/60 pl-2">
            <span className={`h-3.5 w-3.5 rounded-full ${BAR}`} />
            <span className={`h-2 w-24 ${BAR}`} />
          </span>
        </div>
        <div className={`${FILTER_BAR_BOX} h-8 box-content gap-4 px-3.5`}>
          <span className={`h-3 w-4 ${BAR}`} />
          <span className={`h-3 w-4 ${BAR}`} />
          <span className={`ml-auto h-2 w-12 ${BAR}`} />
          <span className={`h-1 w-4 ${BAR}`} />
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
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
      </div>
      <span
        aria-hidden="true"
        className="spectrum-scan pointer-events-none absolute inset-y-0 left-0 w-1/3"
      />
    </div>
  )
}
