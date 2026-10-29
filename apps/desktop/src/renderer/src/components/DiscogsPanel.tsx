import { ChevronRight, ListFilter, SearchX, Sparkles } from 'lucide-react'
import type React from 'react'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReleaseTrack, SearchProviderId, SearchResult } from '../../../shared/types'
import type { DiscogsBrowser } from '../hooks/useDiscogsBrowser'
import { editorPlace } from '../lib/editorPlace'
import { useOpenSettings } from '../lib/openSettingsContext'
import {
  joinArtists,
  type ReleaseMetaPatch,
  resultIdentity,
  resultPressing,
  trackDisplayTitle,
} from '../lib/release'
import { contentDeficit } from '../lib/resize'
import { holdOrder } from '../lib/triage'
import type { TrackItem } from '../types'
import { AlbumMatchRows } from './AlbumMatchRows'
import { ResizeHandle } from './ResizeHandle'
import { SearchInput } from './SearchInput'
import { Select } from './Select'
import { Tooltip } from './Tooltip'
import { TopProgressBar } from './TopProgressBar'

// How many result rows ramp in, and how far apart. Six covers roughly what the column shows
// before the fold, which is the whole point: the stagger exists to make a resolved search
// read as results arriving, and a row nobody can see yet has nothing to announce. 40ms is
// brisk enough that six rows are all in within a quarter second.
const STAGGERED_ROWS = 6
const STAGGER_STEP_MS = 40

const resultKeyOf = (r: { provider: string; id: number | string }): string =>
  `${r.provider}:${r.id}`

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
  showTokenTip: boolean
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  onApplyMatches:
    | ((patches: { id: string; patch: ReleaseMetaPatch }[], provider: SearchProviderId) => void)
    | undefined
  selectTrack: (track: ReleaseTrack) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  // The release formats search is restricted to (Settings → Search). Empty = no filter.
  // Shown as a hint so a thinned or empty result set reads as the filter at work.
  formatFilter: string[]
  width: number
  onResizeStart: (e: React.PointerEvent) => void
  onFit: (deficit: number) => void
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
  showTokenTip,
  isMulti,
  selectedTracks,
  onApplyMatches,
  selectTrack,
  searchInputRef,
  formatFilter,
  width,
  onResizeStart,
  onFit,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const onOpenSettings = useOpenSettings()
  const {
    query,
    setQuery,
    doSearch,
    results: liveResults,
    providerCounts,
    providerFilter,
    setProviderFilter,
    release,
    openKey: liveOpenKey,
    suggestedKey: liveSuggestedKey,
    suggestedConfident: liveSuggestedConfident,
    pendingProviders,
    searchProgress,
    held,
    showHeld: liveShowHeld,
    choosingBest: liveChoosingBest,
    loading,
    busy,
    noResults,
    error,
    previewRelease: livePreviewRelease,
  } = browser
  // While the pointer is over the list, nothing the search does on its own moves a row:
  // the best-match pin, its slot and its auto-open wait until the pointer leaves, so a row
  // never slides away from a user about to click it. The user's own clicks apply at once.
  const [pointerIn, setPointerIn] = useState(false)
  const userActed = useRef(false)
  const liveView = {
    results: liveResults,
    openKey: liveOpenKey,
    suggestedKey: liveSuggestedKey,
    suggestedConfident: liveSuggestedConfident,
    choosingBest: liveChoosingBest,
  }
  const view = useRef(liveView)
  if (!pointerIn || userActed.current) {
    view.current = liveView
    userActed.current = false
  } else {
    view.current = {
      ...view.current,
      results: holdOrder(view.current.results, liveResults, resultKeyOf),
    }
  }
  const { results, openKey, suggestedKey, suggestedConfident, choosingBest } = view.current
  // The album applied before this track opened rides first, so tagging a release track
  // after track never means finding it again. Fixed for the mount, and shown with the
  // results so the filter row arriving above them never slides it down.
  const [pinned] = useState(() => editorPlace.lastAlbum)
  const pinnedKey = pinned ? resultKeyOf(pinned) : null
  const listed = pinned ? results.filter((r) => resultKeyOf(r) !== pinnedKey) : results
  const applyTrack = (track: ReleaseTrack): void => {
    const open = [...(pinned ? [pinned] : []), ...results].find(
      (r) => resultKeyOf(r) === liveOpenKey,
    )
    if (open) editorPlace.lastAlbum = open
    selectTrack(track)
  }
  const previewRelease = (r: SearchResult): void => {
    userActed.current = true
    livePreviewRelease(r)
  }
  const showHeld = (): void => {
    userActed.current = true
    liveShowHeld()
  }
  const suggestedTitle = suggestedKey
    ? results.find((r) => `${r.provider}:${r.id}` === suggestedKey)?.title
    : undefined
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
    onFit(contentDeficit(rows))
  }, [onFit])

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
  // A late answer takes its ranked place among the rows on screen (useDiscogsBrowser). The
  // rows it lands above slide down from where they were instead of jumping, and the rows
  // that just arrived are marked for a moment so they don't slip in unnoticed. A new search
  // is a new list, not a late arrival: when none of its rows was on screen, nothing is marked.
  const shownKeys = useRef<ReadonlySet<string>>(new Set())
  const freshKeys = useMemo(() => {
    const keys = results.map(resultKeyOf)
    const shown = shownKeys.current
    return keys.some((k) => shown.has(k))
      ? new Set(keys.filter((k) => !shown.has(k)))
      : new Set<string>()
  }, [results])
  const cardTops = useRef(new Map<string, number>())
  const slidFor = useRef(results)
  useLayoutEffect(() => {
    const cards =
      resultsRef.current?.querySelectorAll<HTMLElement>('[data-testid="result-card"]') ?? []
    const listChanged = slidFor.current !== results
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const tops = new Map<string, number>()
    for (const card of cards) {
      const key = card.dataset.key ?? ''
      const top = card.offsetTop
      tops.set(key, top)
      const was = cardTops.current.get(key)
      if (listChanged && !still && was !== undefined && was !== top) {
        card.animate?.([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
          duration: 260,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        })
      }
    }
    cardTops.current = tops
    slidFor.current = results
    shownKeys.current = new Set(results.map(resultKeyOf))
  })
  const moveResultFocus = useCallback(
    (to: -1 | 1 | 'first' | 'last'): void => {
      // Las pistas de una tarjeta plegada siguen montadas (para que la animación de cierre
      // no parpadee) pero están `inert`: si se contaran aquí, ↓ pararía en pistas invisibles
      // y la columna parecería congelada en el primer álbum.
      const items = Array.from(
        resultsRef.current?.querySelectorAll<HTMLElement>(
          '[data-testid="discogs-result"], [data-testid="discogs-track"]',
        ) ?? [],
      ).filter((el) => !el.closest('[inert]'))
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
  const tierLabel = tr(matchTier === 'high' ? 'editor.matchSuggested' : 'match.toConfirm')
  // What answered after the list showed waits at the foot of the list, where "Still
  // searching" stood, so its arrival moves no row; showing it is the user's own click.
  const heldButton = held.count > 0 && (
    <div className="flex justify-center px-1.5 pt-1.5 pb-0.5">
      <button
        type="button"
        data-testid="discogs-held"
        onClick={showHeld}
        className="press rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-hover)]"
      >
        {tr('editor.heldResults', {
          count: held.count,
          providers: held.providers.map((p) => tr(`settings.provider.${p}`)).join(', '),
        })}
      </button>
    </div>
  )
  const renderCard = (r: SearchResult, i: number): React.JSX.Element => {
    const rk = resultKeyOf(r)
    const expanded = openKey === rk
    const suggested = suggestedKey === rk
    const best = suggested && suggestedConfident && i === 0 && rk !== pinnedKey
    const loaded = expanded && openKey === liveOpenKey && !!release && !loading
    // Both empty for every Bandcamp row — its search returns no year, label or
    // catalogue — so each span is dropped rather than rendered blank, and the row
    // keeps its one-line height instead of paying for a line that says nothing.
    const identity = resultIdentity(r)
    const pressing = resultPressing(r)
    return (
      <Fragment key={rk}>
        {best && <BestMatchLabel testid="best-match-label" label={tr('editor.bestMatch')} />}
        <div data-testid="result-card" data-key={rk} className="px-1.5 pt-0.5">
          {/* Result as a card, matching the track list's rows so both columns read as the
                      same component. The wide column earns the title a full two lines instead of a
                      hard cut, and the release line shows year · label · catalogue no · format ·
                      country in full — the catalogue number and the pressing country being the
                      surest ways to tell two near-identical results apart. */}
          <button
            type="button"
            data-testid="discogs-result"
            data-fresh={freshKeys.has(rk) || undefined}
            aria-expanded={expanded}
            onClick={() => previewRelease(r)}
            // Only the rows above the fold ramp in; past STAGGERED_ROWS the delay is
            // zero, so a result the user scrolls down to is already there instead of
            // waiting on a queue of animations it can't see. Decoration must never
            // make content arrive later than it could.
            style={{
              animationDelay: `${i < STAGGERED_ROWS ? i * STAGGER_STEP_MS : 0}ms`,
            }}
            className={`press result-in ${freshKeys.has(rk) ? 'result-new' : ''} group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:bg-[var(--color-accent-soft)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)] focus-visible:outline-none ${
              // The open card takes no fill: the tracklist unfolding under it already
              // says which one is open, and the applied track keeps the column's only fill.
              expanded ? '' : 'hover:bg-[var(--color-hover)]/85'
            }`}
          >
            <ResultThumb src={r.thumb} />
            <span className="min-w-0 flex-1">
              <span data-fit className="block truncate text-sm leading-snug">
                {r.title}
              </span>
              {/* Origin, suggestion and release facts share one line under the title.
                          Stacked on three lines they set the row's height at nearly twice the
                          track list's for the same one line of content — and for a Bandcamp
                          result, which carries no year/label/catalogue at all, two of those
                          lines said nothing. The facts truncate so one long Discogs row can't
                          blow up the card. */}
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                {/* The provider is an origin label, so it reads as the same plain
                            secondary text the track list gives the WAV/FLAC format tag —
                            same vocabulary across both columns. */}
                <span
                  data-testid="result-provider"
                  data-provider={r.provider}
                  className="shrink-0 text-[11px] font-medium leading-4 text-fg-dim"
                >
                  {tr(`settings.provider.${r.provider}`)}
                </span>
                {/* The suggestion is the track list's match sparkle, not a filled
                            chip: a signal, marked like the row's quality tick, with its
                            "Suggested" label in the tooltip. Never a check — nothing is
                            applied until the user opens the release and picks a track. */}
                {suggested && (
                  // role="img" with the word as its name: the tooltip only answers a
                  // pointer, and the name joins the row's so a screen reader hears
                  // which release is suggested.
                  <span
                    data-testid="result-suggested"
                    role="img"
                    aria-label={tr('editor.matchSuggested')}
                    className="group/dot relative flex shrink-0 text-[var(--color-accent)]"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    <Tooltip label={tr('editor.matchSuggested')} align="start" scope="dot" />
                  </span>
                )}
                {/* Curated, not raw: the first label only (Discogs' label[] also lists
                            publishers, distributors and studios — a wall of noise), and just the
                            base format (medium + size, e.g. "Vinyl, 12\"") dropping RPM/Single/
                            Stereo. */}
                {identity && (
                  <span className="min-w-0 truncate text-[11px] text-fg-dim leading-4">
                    {identity}
                  </span>
                )}
              </span>
              {/* The pressing goes on its own line: with the country appended, all five
                          facts overflowed one line for 19% of results and the ellipsis ate the
                          country — the field that separates a UK 12" from its German repress.
                          Only rendered when there is a pressing to describe, so a Bandcamp or
                          Deezer row stays the same height it was. */}
              {pressing && (
                <span className="mt-px flex min-w-0 items-center">
                  <span className="min-w-0 truncate text-[11px] text-fg-dim leading-4">
                    {pressing}
                  </span>
                </span>
              )}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 text-fg-faint transition-transform ${
                expanded
                  ? 'rotate-90'
                  : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
              }`}
            />
          </button>
          <CollapsibleTracks open={expanded}>
            <div className="flex flex-col gap-0.5 pb-1">
              {/* The album match gets a band because it is a different task
                          (pairing several files); a single file's tracks need none, indented
                          under the release they already read as its tracklist. */}
              {isMulti && (
                <div className="border-y border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1">
                  <span className="text-[11px] font-semibold text-fg-dim">{tr('match.title')}</span>
                </div>
              )}
              {loaded && release ? (
                isMulti && selectedTracks && onApplyMatches ? (
                  <AlbumMatchRows
                    files={selectedTracks}
                    release={release}
                    onApply={onApplyMatches}
                  />
                ) : (
                  release.tracklist.map((t) => {
                    // A compilation credits each track to its own artist; shown
                    // only where it differs from the album's, so a one-artist
                    // album keeps its single-line rows.
                    const trackArtist = joinArtists(t.artists)
                    const ownArtist =
                      trackArtist !== '' && trackArtist !== joinArtists(release.artists)
                        ? trackArtist
                        : ''
                    const fullTitle = ownArtist
                      ? `${ownArtist} - ${trackDisplayTitle(t)}`
                      : trackDisplayTitle(t)
                    return (
                      <button
                        key={`${t.position}-${t.title}`}
                        type="button"
                        data-testid="discogs-track"
                        aria-current={t === appliedTrack || t === matchedTrack ? 'true' : undefined}
                        onClick={() => applyTrack(t)}
                        className={`flex w-full items-center gap-3 rounded-lg py-1.5 pr-3 pl-4 text-left focus-visible:bg-[var(--color-accent-soft)] focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)] focus-visible:outline-none ${
                          // Same selection fill and rounded shape as the library row, so the
                          // applied track reads with equal weight in both columns (was a faint
                          // tint that looked second-class next to the filled library row).
                          t === appliedTrack || t === matchedTrack
                            ? 'is-applied bg-[var(--color-row-selected)]'
                            : 'hover:bg-[var(--color-hover)]'
                        }`}
                      >
                        <span className="w-8 shrink-0 text-xs tabular-nums text-fg-dim">
                          {t.position}
                        </span>
                        <span
                          data-fit
                          title={fullTitle}
                          className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
                        >
                          {trackDisplayTitle(t)}
                          {ownArtist && (
                            <span className="block truncate text-xs font-normal text-fg-dim">
                              {ownArtist}
                            </span>
                          )}
                        </span>
                        {/* The suggestion mark mirrors the track list's match sparkle
                                  (not a tick: a check reads as "already applied", but the
                                  metadata is only applied when the row is clicked). Accent
                                  for a confident tier, amber for a review-tier one, so the
                                  colour tells the user whether to trust it — the same
                                  vocabulary the left column uses. Sits in a fixed slot so a
                                  row without a suggestion keeps the duration aligned. */}
                        <span className="flex w-3 shrink-0 justify-center">
                          {t === matchedTrack && matchTier && (
                            // Accent versus amber was the whole difference between the
                            // tiers, so the name and tooltip say which one it is, for a
                            // screen reader and for anyone who can't tell the colours apart.
                            <span
                              data-testid="track-confidence"
                              data-confidence={matchTier}
                              role="img"
                              aria-label={tierLabel}
                              className={`group/dot relative flex ${
                                matchTier === 'high' ? 'text-[var(--color-accent)]' : 'text-warn'
                              }`}
                            >
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              <Tooltip label={tierLabel} align="end" scope="dot" />
                            </span>
                          )}
                        </span>
                        <span className="min-w-[34px] shrink-0 text-right text-xs tabular-nums text-fg-dim">
                          {t.duration}
                        </span>
                      </button>
                    )
                  })
                )
              ) : (
                <TrackSkeleton />
              )}
            </div>
          </CollapsibleTracks>
        </div>
      </Fragment>
    )
  }
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
        data-testid="matches-column"
        style={{ width }}
        className="flex shrink-0 flex-col border-r border-[var(--color-line)]"
      >
        <div className="relative border-b border-[var(--color-line)] pb-2">
          {/* The divider fills as the catalogs answer, and slides while one catalog or the
              best match is still working. Opening a release is not a search. */}
          {busy && !loading && (
            <TopProgressBar
              fraction={
                searchProgress && searchProgress.total > 1
                  ? searchProgress.answered / searchProgress.total
                  : pendingProviders.length > 0 && providerCounts.length > 1
                    ? 1 - pendingProviders.length / providerCounts.length
                    : null
              }
            />
          )}
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
          {showTokenTip && (
            <p data-testid="discogs-token-tip" className="px-1.5 pt-2 text-xs text-fg-muted">
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
          {/* Nothing about a search is audible otherwise: the spinner is an icon, the
              skeleton is hidden and rows just appear. Mounted empty from the start so
              assistive tech is already listening when the first search runs. Opening a
              release also sets busy, but that is not a search, so it says nothing. */}
          <p data-testid="discogs-status" role="status" className="sr-only">
            {busy && !loading
              ? tr('editor.searching')
              : noResults
                ? tr('editor.noResults')
                : results.length > 0
                  ? [
                      tr('editor.resultsCount', { count: results.length }),
                      suggestedTitle && tr('editor.suggestedStatus', { title: suggestedTitle }),
                    ]
                      .filter(Boolean)
                      .join('. ')
                  : ''}
          </p>
          {error && (
            <p role="alert" className="px-1.5 pt-2 text-xs text-danger">
              {error}
            </p>
          )}
          {(showProviderFilter || formatFilter.length > 0) && (
            <div className="flex items-center gap-2 px-1.5 pt-2">
              {showProviderFilter && (
                <Select
                  testid="provider-filter"
                  bare
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
          data-testid="discogs-results"
          onKeyDown={onResultsKeyDown}
          onPointerEnter={() => setPointerIn(true)}
          onPointerLeave={() => setPointerIn(false)}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {pinned && (listed.length > 0 || noResults) && (
            <>
              <BestMatchLabel testid="last-applied-label" label={tr('editor.lastApplied')} />
              {renderCard(pinned, 0)}
            </>
          )}
          {busy && listed.length === 0 ? (
            // The list waits for every catalog before it shows, so nothing appears only to
            // move: skeleton rows mirror the result-row shape, and the count says the wait
            // is going somewhere.
            <>
              {searchProgress && searchProgress.total > 1 && (
                <p data-testid="discogs-progress" className="px-3 pt-2 text-[11px] text-fg-faint">
                  {tr('editor.searchProgress', searchProgress)}
                </p>
              )}
              <SkeletonRows testid="discogs-skeleton" count={4} />
            </>
          ) : noResults ? (
            <div
              data-testid="discogs-no-results"
              className="flex flex-col items-center justify-center gap-2 px-6 pt-12 text-center text-xs text-fg-dim"
            >
              <SearchX className="h-5 w-5 text-fg-faint" aria-hidden="true" />
              {providerFilter !== 'all' && providerTotal > 0
                ? tr('editor.noResultsFromSource', {
                    provider: tr(`settings.provider.${providerFilter}`),
                  })
                : tr('editor.noResults')}
            </div>
          ) : listed.length === 0 ? (
            <p className="px-3 pt-3 text-xs text-fg-faint">{tr('editor.chooseAlbumHint')}</p>
          ) : (
            <>
              {choosingBest && (
                <div data-testid="best-match-slot">
                  <BestMatchLabel label={tr('editor.bestMatch')} />
                  <SkeletonRows testid="best-match-skeleton" count={1} />
                </div>
              )}
              {listed.map(renderCard)}
              {heldButton}
            </>
          )}
          {/* A catalog still searching: its rows will wait behind the button, not land here,
              so the panel names it instead of drawing rows that will not come. */}
          {listed.length > 0 && pendingProviders.length > 0 && (
            <p data-testid="discogs-pending" className="px-3 py-2 text-[11px] text-fg-faint">
              {tr('editor.stillSearching', {
                providers: pendingProviders.map((p) => tr(`settings.provider.${p}`)).join(', '),
              })}
            </p>
          )}
        </div>
      </div>

      <ResizeHandle
        onPointerDown={onResizeStart}
        onDoubleClick={autoFitDiscogs}
        title={tr('editor.fitHint')}
      />
    </>
  )
})

// Placeholder rows shaped like a result row, for a search with rows still to come, so the
// list never pops into an area that looked idle. The side padding adds up the card's own
// (its wrapper and its button) so the placeholder thumbnail lines up with the real ones.
// A thumbnail that fails to load (a MusicBrainz release without Cover Art Archive art
// answers 404, archive.org sometimes 500s) falls back to the empty slot instead of the
// browser's broken-image glyph, which reads as an app fault.
function ResultThumb({ src }: { src: string | undefined }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!src || failed)
    return (
      <div
        data-testid="result-thumb-empty"
        className="h-[30px] w-[30px] shrink-0 rounded-md bg-[var(--color-panel-2)]"
      />
    )
  return (
    <img
      data-testid="result-thumb"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-[30px] w-[30px] shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-on-scrim/10"
    />
  )
}

function SkeletonRows({ testid, count }: { testid: string; count: number }): React.JSX.Element {
  return (
    <div data-testid={testid} aria-hidden="true">
      {[0, 1, 2, 3].slice(0, count).map((i) => (
        <div
          key={i}
          data-testid="skeleton-row"
          className="flex items-center gap-2.5 border-b border-[var(--color-line)]/60 px-4 py-1.5"
        >
          <span className="skeleton-sweep h-[30px] w-[30px] shrink-0 rounded-md bg-[var(--color-panel-2)]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="skeleton-sweep h-3 w-3/4 rounded bg-[var(--color-panel-2)]" />
            <span className="skeleton-sweep h-2.5 w-1/2 rounded bg-[var(--color-panel-2)]" />
          </span>
        </div>
      ))}
    </div>
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
  const inner = useRef<HTMLDivElement>(null)

  // Al plegar, el contenido sigue montado para que la animación de cierre no parpadee, y
  // `inert` lo saca del tabulador: si no, el Tab entra en pistas invisibles. `inert` no
  // mueve el foco que ya estuviera dentro — lo deja huérfano en el body — así que lo
  // devolvemos al botón de la tarjeta, que comparte contenedor con este colapsable y es
  // donde el usuario acaba de pulsar para cerrar.
  useEffect(() => {
    if (open) return
    if (!inner.current?.contains(document.activeElement)) return
    // El botón de ESTA tarjeta, acotando la búsqueda a su contenedor: buscarlo desde un
    // ancestro más alto devolvía el primer resultado de toda la lista, y entonces cada ↓
    // por los resultados rebotaba al primer álbum.
    const card = inner.current
      .closest('[data-testid="result-card"]')
      ?.querySelector('[data-testid="discogs-result"]')
    if (card instanceof HTMLElement) card.focus()
  }, [open])

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div
        ref={inner}
        inert={!open}
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
    <div aria-hidden="true">
      {widths.map((w) => (
        <div key={w} className="flex items-center gap-3 py-1.5 pr-3 pl-4">
          <span className="skeleton-sweep h-3 w-6 shrink-0 rounded bg-[var(--color-panel-2)]" />
          <span
            className="skeleton-sweep h-3 rounded bg-[var(--color-panel-2)]"
            style={{ width: w }}
          />
        </div>
      ))}
    </div>
  )
}

// Heads the release the auto-match opens, at the top of the list where it always sits.
function BestMatchLabel({ label, testid }: { label: string; testid?: string }): React.JSX.Element {
  return (
    <p
      data-testid={testid}
      className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint"
    >
      {label}
    </p>
  )
}
