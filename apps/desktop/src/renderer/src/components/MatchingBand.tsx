import type React from 'react'
import { useTranslation } from 'react-i18next'

const BUTTON =
  'press rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-hover)] disabled:opacity-40'

export function MatchingBand({
  tracks,
  selected = false,
  onCreate,
}: {
  tracks: number
  selected?: boolean
  onCreate: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="mx-3 my-2 flex justify-end">
      <button
        type="button"
        data-testid="matching-create-playlist"
        disabled={tracks === 0}
        onClick={onCreate}
        className={BUTTON}
      >
        <span className="grid">
          <span
            aria-hidden={selected}
            className={`col-start-1 row-start-1 ${selected ? 'invisible' : ''}`}
          >
            {tr('sources.matchingCreate')}
          </span>
          <span
            aria-hidden={!selected}
            className={`col-start-1 row-start-1 ${selected ? '' : 'invisible'}`}
          >
            {tr('sources.matchingCreateSelection')}
          </span>
        </span>
      </button>
    </div>
  )
}
