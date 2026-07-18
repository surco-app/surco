import { ChevronRight, ListFilter, SearchX } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReleaseTrack, SearchProviderId } from '../../../shared/types'
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
  // The entry the file's tags currently spell out — the user's applied pick. Kept apart
  // from the suggestion: a deliberate pick must stay highlighted even when the fuzzy
  // score is too weak to suggest anything (e.g. a rip whose length misses the printed
  // duration), while the badge stays the matcher's own verdict.
  appliedTrack: ReleaseTrack | undefined
  hasToken: boolean
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  onApplyMatches:
    | ((patches: { id: string; patch: ReleaseMetaPatch }[], provider: SearchProviderId) => void)
    | undefined
  selectTrack: (track: ReleaseTrack) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onOpenSettings: (tab?: 'general' | 'search' | 'naming') => void
  // The release formats search is restricted to (Settings → Search). Empty = no filter.
  // Shown as a hint so a thinned or empty result set reads as the filter at work.
  formatFilter: string[]
  // The column's persisted width and its save hook: the panel remounts on every
  // track switch (the editor is keyed by track), so a width held only in state
  // used to snap back the moment the user changed tracks.
  resultsWidth: number | null
  onResultsWidthChange: (width: number) => void
}

// The Discogs column: the search box, its results, and the expanded release's
// tracklist (or the album-match grid in multi-select). All search/release state lives
// in the useDiscogsBrowser hook passed in as `browser`; this component is the view.
// Memoized so a keystroke in a metadata field (which doesn't touch any Discogs
// state) skips reconciling the panel's results/tracklist subtree — useDiscogsBrowser
// itself memoizes `browser` for this reason. Not a complete guarantee: matchedTrack/
// matchTier still derive from the editor's library-verdict effect and can change
// identity independently; this closes the browser-driven half of the re-renders.
export const DiscogsPanel = memo(function DiscogsPanel({
  browser,
  matchedTrack,
  matchTier,
  appliedTrack,
  hasToken,
  isMulti,
  selectedTracks,
  onApplyMatches,
  selectTrack,
  searchInputRef,
  onOpenSettings,
  formatFilter,
  resultsWidth,
  onResultsWidthChange,
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
    noResults,
    error,
    previewRelease,
  } = browser
  const discogs = useResizableWidth(resultsWidth ?? 315, 300, 720, onResultsWidthChange)
  // A header focus preset parks this column by writing resultsWidth to settings, which
  // arrives here as a prop change. Mirror it into the drag state so the column actually
  // moves (a drag commits the same value back, so this no-ops on the user's own drags).
  useEffect(() => {
    if (resultsWidth != null) discogs.syncTo(resultsWidth)
  }, [resultsWidth, discogs.syncTo])

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
                // A format filter is a Settings preference, not something to repeat as a
                // line of text on every search — a discreet funnel flags it's on (so a thin
                // result list reads as the filter, not a broken search), names the formats on
                // hover, and clicking jumps to where it's changed.
                <button
                  type="button"
                  data-testid="discogs-format-filter"
                  onClick={() => onOpenSettings('search')}
                  aria-label={tr('editor.formatFilter', {
                    formats: formatFilter.map((f) => tr(`settings.format.${f}`)).join(', '),
                  })}
                  className="press relative ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-accent)] transition-colors hover:bg-[var(--color-line-strong)]"
                >
                  <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
                  <Tooltip
                    label={tr('editor.formatFilter', {
                      formats: formatFilter.map((f) => tr(`settings.format.${f}`)).join(', '),
                    })}
                  />
                </button>
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
          ) : noResults ? (
            <div
              data-testid="discogs-no-results"
              className="flex flex-col items-center justify-center gap-2 px-6 pt-12 text-center text-xs text-fg-dim"
            >
              <SearchX className="h-5 w-5 text-fg-faint" aria-hidden="true" />
              {tr('editor.noResults')}
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
                <div key={rk} className="px-1.5 pt-1.5">
                  {/* Result as a card, matching the track list's rows so both columns read as the
                      same component. The wide column earns the title a full two lines instead of a
                      hard cut, and the release line shows year · label · catalogue no · format in
                      full — the catalogue number being the surest way to tell pressings apart. */}
                  <button
                    type="button"
                    data-testid="discogs-result"
                    aria-expanded={expanded}
                    onClick={() => previewRelease(r)}
                    className={`press group relative flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors ${
                      expanded
                        ? 'bg-[var(--color-accent-soft)]/85'
                        : 'bg-[var(--color-panel)]/50 hover:bg-[var(--color-panel-2)]/85'
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
                      <span data-fit className="block truncate text-sm leading-snug">
                        {r.title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
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
                      </span>
                      {/* Curated, not raw: the first label only (Discogs' label[] also lists
                          publishers, distributors and studios — a wall of noise), and just the
                          base format (medium + size, e.g. "Vinyl, 12\"") dropping RPM/Single/
                          Stereo. Truncates so one long row can't blow up the card's height. */}
                      <span className="mt-1 block truncate text-xs text-fg-dim leading-snug">
                        {[r.year, r.label?.[0], r.catno, r.format?.slice(0, 2).join(', ')]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className={`mt-0.5 h-3 w-3 shrink-0 text-fg-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
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
                              aria-current={
                                t === appliedTrack || t === matchedTrack ? 'true' : undefined
                              }
                              onClick={() => selectTrack(t)}
                              className={`flex w-full items-center gap-3 py-1.5 pr-3 pl-4 text-left hover:bg-[var(--color-panel-2)] ${
                                t === appliedTrack || t === matchedTrack
                                  ? 'bg-[var(--color-accent-soft)]'
                                  : ''
                              }`}
                            >
                              <span className="w-8 shrink-0 text-xs tabular-nums text-fg-dim">
                                {t.position}
                              </span>
                              <span data-fit className="min-w-0 flex-1 truncate text-sm">
                                {t.title}
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
})

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
