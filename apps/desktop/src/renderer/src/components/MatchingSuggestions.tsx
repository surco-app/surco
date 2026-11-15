import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PairSuggestion } from '../../../shared/matchingSuggestions'
import type { CollectionTrack } from '../../../shared/types'

const STEP = 5

function TrackLine({ track }: { track: CollectionTrack }): React.JSX.Element {
  return (
    <span className="block min-w-0 px-1 py-0.5">
      <span className="block truncate text-sm text-fg">{track.title}</span>
      <span className="block truncate text-xs text-fg-dim">{track.artist}</span>
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
    <section data-testid="matching-suggestions" className="mx-3 mb-3 flex flex-col gap-2">
      <h2 className="flex items-baseline justify-between px-1 text-section font-semibold">
        {tr('sources.matchingSuggested')}
        <span className="text-xs font-normal text-fg-dim tabular-nums">{named.length}</span>
      </h2>
      {named.slice(0, shown).map((s) => (
        <div
          key={s.pair.join('|')}
          data-testid="matching-suggestion"
          className="flex flex-col rounded-[10px] border border-dashed border-[var(--color-accent)]/45 p-1.5"
        >
          <TrackLine track={tracks.get(s.pair[0]) as CollectionTrack} />
          <TrackLine track={tracks.get(s.pair[1]) as CollectionTrack} />
          <span className="block px-1 pt-1 text-xs text-fg-dim">
            {tr('sources.matchingTimes', { count: s.times })}
          </span>
          <div className="flex items-center justify-end gap-2 px-1 pt-1">
            <button
              type="button"
              data-testid="matching-suggestion-dismiss"
              onClick={() => onDismiss(s)}
              className="press rounded px-2 py-1 text-xs text-fg-dim hover:text-fg"
            >
              {tr('sources.matchingDismiss')}
            </button>
            <button
              type="button"
              data-testid="matching-suggestion-match"
              onClick={() => onMatch(s)}
              className="press rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
            >
              {tr('trackList.context.matching')}
            </button>
          </div>
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
