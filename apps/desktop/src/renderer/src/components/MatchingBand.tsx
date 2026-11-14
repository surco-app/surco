import type React from 'react'
import { useTranslation } from 'react-i18next'

const BUTTON =
  'press rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-hover)] disabled:opacity-40'

export function MatchingBand({
  tracks,
  onCreate,
}: {
  tracks: number
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
        {tr('sources.matchingCreate')}
      </button>
    </div>
  )
}
