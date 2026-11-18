import { ListPlus } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from './Tooltip'

export function MatchingCreate({
  tracks,
  selected = false,
  onCreate,
}: {
  tracks: number
  selected?: boolean
  onCreate: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const label = tr(selected ? 'sources.matchingCreateSelection' : 'sources.matchingCreate')
  return (
    <button
      type="button"
      data-testid="matching-create-playlist"
      disabled={tracks === 0}
      onClick={onCreate}
      aria-label={label}
      className="press relative flex h-8 w-8 compact:h-7 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40"
    >
      <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
      <Tooltip label={label} />
    </button>
  )
}
