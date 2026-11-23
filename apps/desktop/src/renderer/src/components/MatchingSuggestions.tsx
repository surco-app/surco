import { Sparkles, X } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PairSuggestion } from '../../../shared/matchingSuggestions'
import type { CollectionTrack } from '../../../shared/types'
import { SectionBody } from './SectionBody'
import { MatchingIcon } from './SourceIcons'
import { Tooltip } from './Tooltip'

const STEP = 3

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

export function nameable(
  suggestions: readonly PairSuggestion[],
  tracks: ReadonlyMap<string, CollectionTrack>,
): PairSuggestion[] {
  return suggestions.filter((s) => tracks.has(s.pair[0]) && tracks.has(s.pair[1]))
}

export function MatchingSuggestionsToggle({
  open,
  disabled = false,
  onToggle,
}: {
  open: boolean
  disabled?: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <button
      type="button"
      data-testid="matching-suggestions-toggle"
      aria-pressed={open}
      aria-label={tr('sources.matchingSuggested')}
      disabled={disabled}
      onClick={onToggle}
      className="press relative flex h-8 w-8 compact:h-7 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40 aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-[var(--color-accent)]"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <Tooltip label={tr('sources.matchingSuggested')} />
    </button>
  )
}

export function MatchingSuggestions({
  suggestions,
  tracks,
  open,
  onMatch,
  onDismiss,
}: {
  suggestions: readonly PairSuggestion[]
  tracks: ReadonlyMap<string, CollectionTrack>
  open: boolean
  onMatch: (suggestion: PairSuggestion) => void
  onDismiss: (suggestion: PairSuggestion) => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [shown, setShown] = useState(STEP)
  const named = nameable(suggestions, tracks)
  if (named.length === 0) return null
  return (
    <SectionBody open={open}>
      <section
        data-testid="matching-suggestions"
        className="mx-3 mb-2 flex flex-col border-b border-[var(--color-line)] pb-1.5"
      >
        <h2 className="px-2.5 py-1 text-xs font-medium text-fg-dim">
          {tr('sources.matchingSuggested')}
        </h2>
        <div className="flex flex-col gap-0.5 pt-1">
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
                  className="press relative ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--color-accent)] group-hover/row:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)] hover:text-[var(--color-on-accent)] focus-visible:border-[var(--color-accent)]/60"
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
              className="press ml-6.5 self-start rounded-md px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
            >
              {tr('sources.matchingMore')}
            </button>
          )}
        </div>
      </section>
    </SectionBody>
  )
}
