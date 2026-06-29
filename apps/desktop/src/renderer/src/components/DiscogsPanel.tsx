import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useCallback, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReleaseTrack } from '../../../shared/types'
import type { DiscogsBrowser } from '../hooks/useDiscogsBrowser'
import type { ReleaseMetaPatch } from '../lib/release'
import { contentDeficit } from '../lib/resize'
import type { TrackItem } from '../types'
import { AlbumMatchRows } from './AlbumMatchRows'
import { ResizeHandle, useResizableWidth } from './ResizeHandle'
import { SearchInput } from './SearchInput'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

interface Props {
  browser: DiscogsBrowser
  // The tracklist entry that best matches the shown track and its confidence tier,
  // computed by the Editor — which also feeds the same suggestion to the Apple Music
  // lookup — so the highlight and the library badge can never disagree. Already gated:
  // a 'low'-tier match arrives as undefined, since one incidental shared word must not
  // badge a random mix and invite the user to apply the wrong one.
  matchedTrack: ReleaseTrack | undefined
  matchTier: 'high' | 'review' | 'low' | undefined
  hasToken: boolean
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  onApplyMatches: ((patches: { id: string; patch: ReleaseMetaPatch }[]) => void) | undefined
  selectTrack: (track: ReleaseTrack) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onOpenSettings: (tab?: 'general' | 'search' | 'naming') => void
  // The release formats search is restricted to (Settings → Search). Empty = no filter.
  // Shown as a hint so a thinned or empty result set reads as the filter at work.
  formatFilter: string[]
}

// The Discogs column: the search box, its results, and the expanded release's
// tracklist (or the album-match grid in multi-select). All search/release state lives
// in the useDiscogsBrowser hook passed in as `browser`; this component is the view.
export function DiscogsPanel({
  browser,
  matchedTrack,
  matchTier,
  hasToken,
  isMulti,
  selectedTracks,
  onApplyMatches,
  selectTrack,
  searchInputRef,
  onOpenSettings,
  formatFilter,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const {
    query,
    setQuery,
    doSearch,
    results,
    providerCounts,
    providerFilter,
    setProviderFilter,
    release,
    openKey,
    suggestedKey,
    loading,
    busy,
    error,
    previewRelease,
  } = browser
  const discogs = useResizableWidth(315, 300, 720)

  // Double-clicking the divider fits the Discogs column to its results: measure how far each
  // release and track title is clipped (or has to spare) and resize by the widest, so long
  // album names stop truncating — and a column left too wide tightens back up.
  const autoFitDiscogs = useCallback((): void => {
    const spans = document.querySelectorAll<HTMLElement>(
      '[data-testid="discogs-result"] [data-fit], [data-testid="discogs-track"] [data-fit]',
    )
    const rows = Array.from(spans, (s) => ({
      scrollWidth: s.scrollWidth,
      clientWidth: s.clientWidth,
    }))
    discogs.autoFit(contentDeficit(rows))
  }, [discogs.autoFit])

  // The source filter is keyed to the enabled catalogs, not to which ones a given search
  // happened to return: showing it whenever two sources are configured (and there's a
  // result set to filter) keeps it from flickering in and out between searches.
  const providerTotal = providerCounts.reduce((n, p) => n + p.count, 0)
  const showProviderFilter = providerCounts.length > 1 && providerTotal > 0

  // Keyboard navigation through the results, so picking a release is keyboard-only once
  // ⌘2 lands focus here: ↑/↓ (and the j/k vim aliases, matching the track list) rove the
  // result rows and the expanded release's tracks (in DOM order, so a track sits right after
  // the release it belongs to), while Enter/Space on the focused button natively expands a
  // release or applies a track. ↑/k off the top row returns to the search box; the box's ↓
  // dives back into the first result. Handling j/k here (and preventing default) stops them
  // leaking to the global handler, which would otherwise move the track list behind this column.
  const resultsRef = useRef<HTMLDivElement>(null)
  const moveResultFocus = useCallback(
    (to: -1 | 1 | 'first' | 'last'): void => {
      const items = Array.from(
        resultsRef.current?.querySelectorAll<HTMLElement>(
          '[data-testid="discogs-result"], [data-testid="discogs-track"]',
        ) ?? [],
      )
      if (items.length === 0) return
      if (to === 'first') {
        items[0].focus()
        return
      }
      if (to === 'last') {
        items[items.length - 1].focus()
        return
      }
      const current = items.indexOf(document.activeElement as HTMLElement)
      if (to === -1 && current <= 0) {
        searchInputRef.current?.focus()
        return
      }
      items[current < 0 ? 0 : Math.min(items.length - 1, current + to)]?.focus()
    },
    [searchInputRef],
  )
  function onResultsKeyDown(e: React.KeyboardEvent): void {
    const map = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1, Home: 'first', End: 'last' } as const
    const to = map[e.key as keyof typeof map]
    if (to === undefined) return
    e.preventDefault()
    moveResultFocus(to)
  }

  return (
    <>
      <div
        style={{ width: discogs.width }}
        className="flex shrink-0 flex-col border-r border-[var(--color-line)]"
      >
        <div className="border-b border-[var(--color-line)] pb-2">
          {/* Mirrors the track list's header (its search row + filter/sort row) so the two
              columns read as one toolbar side by side: same shared SearchInput chrome.
              Enter searches; the magnifier turns into a spinner while a search is in flight. */}
          <div className="flex items-center gap-1.5 px-1.5 pt-2">
            <SearchInput
              className="min-w-0 flex-1"
              testid="discogs-query"
              inputRef={searchInputRef}
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              busy={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch()
                // ↓ from the search box dives into the results, so search → pick is one
                // continuous keyboard motion.
                else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  moveResultFocus('first')
                }
              }}
              ariaLabel={tr('editor.searchPlaceholder')}
              placeholder={tr('editor.searchPlaceholder')}
              clearLabel={tr('editor.searchClear')}
            />
          </div>
          {!hasToken && (
            <p className="px-1.5 pt-2 text-xs text-fg-muted">
              <Trans
                i18nKey="editor.tokenTip"
                components={[
                  <button
                    key="settings"
                    type="button"
                    onClick={() => onOpenSettings('search')}
                    className="underline underline-offset-2 hover:no-underline"
                  />,
                ]}
              />
            </p>
          )}
          {error && <p className="px-1.5 pt-2 text-xs text-danger">{error}</p>}
          {(showProviderFilter || formatFilter.length > 0) && (
            <div className="flex items-center gap-2 px-1.5 pt-2">
              {showProviderFilter && (
                <Select
                  testid="provider-filter"
                  label={tr('editor.providerFilter')}
                  value={providerFilter}
                  onChange={(v) => setProviderFilter(v as typeof providerFilter)}
                  options={[
                    {
                      value: 'all',
                      label: `${tr('editor.providerFilterAll')} (${providerTotal})`,
                    },
                    ...providerCounts.map((p) => ({
                      value: p.provider,
                      label: `${tr(`settings.provider.${p.provider}`)} (${p.count})`,
                    })),
                  ]}
                />
              )}
              {formatFilter.length > 0 && (
                <p
                  data-testid="discogs-format-filter"
                  className="min-w-0 truncate text-xs text-fg-dim"
                >
                  {tr('editor.formatFilter', {
                    formats: formatFilter.map((f) => tr(`settings.format.${f}`)).join(', '),
                  })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving for the result/track buttons inside; they keep their own native Enter/Space activation and Tab order */}
        <div
          ref={resultsRef}
          onKeyDown={onResultsKeyDown}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {busy && results.length === 0 ? (
            // Searching with nothing to show yet: skeleton rows mirror the result-row
            // shape so the list doesn't pop into an area that looked idle.
            <div data-testid="discogs-skeleton" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex animate-pulse items-center gap-3 border-b border-[var(--color-line)]/60 p-2.5"
                >
                  <span className="h-11 w-11 shrink-0 rounded-md bg-[var(--color-panel-2)]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="h-3 w-3/4 rounded bg-[var(--color-panel-2)]" />
                    <span className="h-2.5 w-1/2 rounded bg-[var(--color-panel-2)]" />
                  </span>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 pt-3 text-xs text-fg-faint">{tr('editor.chooseAlbumHint')}</p>
          ) : (
            results.map((r) => {
              const rk = `${r.provider}:${r.id}`
              const expanded = openKey === rk
              const suggested = suggestedKey === rk
              const loaded = expanded && !!release && !loading
              return (
                <div key={rk} className="border-b border-[var(--color-line)]/60">
                  <button
                    type="button"
                    data-testid="discogs-result"
                    aria-expanded={expanded}
                    onClick={() => previewRelease(r)}
                    className={`group relative flex w-full items-center gap-3 p-2.5 text-left hover:bg-[var(--color-panel-2)] ${
                      expanded ? 'bg-[var(--color-accent-soft)]' : ''
                    }`}
                  >
                    {r.thumb ? (
                      <img
                        src={r.thumb}
                        alt=""
                        loading="lazy"
                        className="h-11 w-11 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
                      />
                    ) : (
                      <div className="h-11 w-11 shrink-0 rounded-md bg-[var(--color-panel-2)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span data-fit className="block truncate text-sm">
                        {r.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span
                          data-testid="result-provider"
                          data-provider={r.provider}
                          className="shrink-0 rounded-full bg-[var(--color-panel-2)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-fg-faint"
                        >
                          {tr(`settings.provider.${r.provider}`)}
                        </span>
                        {suggested && (
                          <span
                            data-testid="result-suggested"
                            className="shrink-0 rounded-full bg-good/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-good"
                          >
                            {tr('editor.matchSuggested')}
                          </span>
                        )}
                        <span className="truncate text-xs text-fg-dim">
                          {[r.year, r.label?.[0], r.format?.join(', ')].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className={`h-3 w-3 shrink-0 text-fg-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                    <Tooltip label={tr('editor.resultHint')} align="start" />
                  </button>
                  <CollapsibleTracks open={expanded}>
                    <div className="pb-1">
                      <p className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                        {isMulti ? tr('match.title') : tr('editor.chooseTrack')}
                      </p>
                      {loaded && release ? (
                        isMulti && selectedTracks && onApplyMatches ? (
                          <AlbumMatchRows
                            files={selectedTracks}
                            release={release}
                            onApply={onApplyMatches}
                          />
                        ) : (
                          release.tracklist.map((t) => (
                            <button
                              key={`${t.position}-${t.title}`}
                              type="button"
                              data-testid="discogs-track"
                              aria-current={t === matchedTrack ? 'true' : undefined}
                              onClick={() => selectTrack(t)}
                              className={`flex w-full items-center gap-3 py-1.5 pr-3 pl-4 text-left hover:bg-[var(--color-panel-2)] ${
                                t === matchedTrack ? 'bg-[var(--color-accent-soft)]' : ''
                              }`}
                            >
                              <span className="w-8 shrink-0 text-xs tabular-nums text-fg-dim">
                                {t.position}
                              </span>
                              {/* Long titles truncate in this narrow column; the themed
                                  tooltip reveals the full name on hover, like the track
                                  list's own rows. */}
                              <span data-fit className="min-w-0 flex-1 truncate text-sm">
                                {t.title}
                                <Tooltip label={t.title} />
                              </span>
                              {t === matchedTrack && matchTier && (
                                // A text label, not a tick: a check icon reads as
                                // "already applied", but the metadata is only applied
                                // when the row is clicked. The tier color tells the
                                // user whether to trust the suggestion or double-check.
                                <span
                                  data-testid="track-confidence"
                                  data-confidence={matchTier}
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                    matchTier === 'high'
                                      ? 'bg-good/15 text-good'
                                      : 'bg-warn/15 text-warn'
                                  }`}
                                >
                                  {tr('editor.matchSuggested')}
                                </span>
                              )}
                              {t.duration && (
                                <span className="shrink-0 text-xs tabular-nums text-fg-dim">
                                  {t.duration}
                                </span>
                              )}
                            </button>
                          ))
                        )
                      ) : (
                        <TrackSkeleton />
                      )}
                    </div>
                  </CollapsibleTracks>
                </div>
              )
            })
          )}
        </div>
      </div>

      <ResizeHandle
        onPointerDown={discogs.onPointerDown}
        onDoubleClick={autoFitDiscogs}
        title={tr('editor.fitHint')}
      />
    </>
  )
}

function CollapsibleTracks({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const lastContent = useRef<React.ReactNode>(null)
  if (open && children) lastContent.current = children
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div
        className={`overflow-hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {open ? children : lastContent.current}
      </div>
    </div>
  )
}

function TrackSkeleton(): React.JSX.Element {
  const widths = ['62%', '48%', '70%']
  return (
    <div className="animate-pulse" aria-hidden="true">
      {widths.map((w) => (
        <div key={w} className="flex items-center gap-3 py-1.5 pr-3 pl-4">
          <span className="h-3 w-6 shrink-0 rounded bg-[var(--color-panel-2)]" />
          <span className="h-3 rounded bg-[var(--color-panel-2)]" style={{ width: w }} />
        </div>
      ))}
    </div>
  )
}
