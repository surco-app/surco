import { X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PairSuggestion } from '../../../shared/matchingSuggestions'
import type { CollectionTrack } from '../../../shared/types'
import { MatchingIcon } from './SourceIcons'
import { Tooltip } from './Tooltip'

const STEP = 5

const DOT = 'h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px] border-[var(--color-accent)]'

function TrackLine({ track }: { track: CollectionTrack }): React.JSX.Element {
  return (
    <span className="block min-w-0 compact:flex compact:items-baseline compact:gap-1.5">
      <span className="block truncate text-sm font-medium text-fg compact:min-w-[3ch]">
        {track.title}
      </span>
      <span className="block truncate text-xs text-fg-dim compact:min-w-0 compact:flex-1">
        {track.artist}
      </span>
    </span>
  )
}

export function MatchingSuggestions({
  suggestions,
  tracks,
  onMatch,
  onDismiss,
}: {
  suggestions: readonly PairSuggestion[]
  tracks: ReadonlyMap<string, CollectionTrack>
  onMatch: (suggestion: PairSuggestion) => void
  onDismiss: (suggestion: PairSuggestion) => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [shown, setShown] = useState(STEP)
  const named = suggestions.filter((s) => tracks.has(s.pair[0]) && tracks.has(s.pair[1]))
  if (named.length === 0) return null
  return (
    <section data-testid="matching-suggestions" className="mx-3 mb-3 flex flex-col gap-0.5">
      <h2 className="mb-1.5 flex items-baseline justify-between px-1 text-section font-semibold">
        {tr('sources.matchingSuggested')}
        <span className="text-xs font-normal text-fg-dim tabular-nums">{named.length}</span>
      </h2>
      {named.slice(0, shown).map((s) => (
        <div
          key={s.pair.join('|')}
          data-testid="matching-suggestion"
          className="group/row grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg py-1.5 pr-1.5 pl-2.5 hover:bg-[var(--color-hover)]/85"
        >
          <span
            aria-hidden="true"
            className="flex flex-col items-center self-stretch pt-[6.5px] pb-[22.5px] compact:pb-[6.5px]"
          >
            <span className={DOT} />
            <span className="my-0.5 w-[1.5px] flex-1 bg-[var(--color-accent)]/45" />
            <span className={DOT} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <TrackLine track={tracks.get(s.pair[0]) as CollectionTrack} />
            <TrackLine track={tracks.get(s.pair[1]) as CollectionTrack} />
          </span>
          <span className="flex items-center gap-0.5">
            <span
              data-testid="matching-suggestion-times"
              className="mr-0.5 min-w-[22px] text-right text-xs tabular-nums text-fg-dim"
            >
              <span aria-hidden="true">{s.times}×</span>
              <span className="sr-only">{tr('sources.matchingTimes', { count: s.times })}</span>
            </span>
            <button
              type="button"
              data-testid="matching-suggestion-dismiss"
              onClick={() => onDismiss(s)}
              aria-label={tr('sources.matchingDismiss')}
              className="press relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-dim opacity-0 hover:bg-[var(--color-hover)] hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <Tooltip label={tr('sources.matchingDismiss')} />
            </button>
            <button
              type="button"
              data-testid="matching-suggestion-match"
              onClick={() => onMatch(s)}
              aria-label={tr('trackList.context.matching')}
              className="press relative ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-accent)]/60 text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)]"
            >
              <MatchingIcon size={15} />
              <Tooltip label={tr('trackList.context.matching')} />
            </button>
          </span>
        </div>
      ))}
      {shown < named.length && (
        <button
          type="button"
          data-testid="matching-suggestions-more"
          onClick={() => setShown((n) => n + STEP)}
          className="press self-start rounded-md px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
        >
          {tr('sources.matchingMore')}
        </button>
      )}
    </section>
  )
}
