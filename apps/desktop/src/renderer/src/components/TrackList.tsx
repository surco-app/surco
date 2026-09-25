import { Check, CircleAlert, Music, Play, TriangleAlert, Undo2, X } from 'lucide-react'
import type React from 'react'
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { matchChord } from '../../../shared/shortcutDefaults'
import { type Chord, eventToChord } from '../../../shared/shortcuts'
import type { OutputFormat } from '../../../shared/types'
import { useStableCallback } from '../hooks/useStableCallback'
import { isStale } from '../lib/dirty'
import { formatTime } from '../lib/duration'
import { isMacOS } from '../lib/platform'
import { STAGE_PROGRESS } from '../lib/progress'
import type { ClickMods } from '../lib/selection'
import { sourceFormat, type TrackQuality, trackQuality } from '../lib/triage'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'

const isMac = isMacOS()

interface Props {
  tracks: TrackItem[]
  selectedId: string | null
  selectedIds: ReadonlySet<string>
  outputFormat: OutputFormat
  // The effective key bindings (defaults + the user's overrides), read by the row to
  // resolve Shift+F10 (or whatever it's been rebound to) to the track-menu command.
  bindings: Map<string, Chord>
  onSelect: (id: string, mods: ClickMods) => void
  // Double-clicking a row plays it: opens the floating player straight on that track.
  onActivate: (track: TrackItem) => void
  onRemove: (id: string) => void
  // The swipe's removal: that one row, never the selection around it, and without asking,
  // the way Mail's swipe deletes one message. ⌫ and the menu keep onRemove and its confirm.
  onSwipeRemove: (id: string) => void
  // Applies the row's pending review-tier suggestion — the mouse half of the
  // accept-review command. The sweep stored the release for one-action acceptance
  // (useAutoMatch: "shortcut or click"), but the click never existed: the amber
  // spark was inert, and accept-review ships with no default chord, so the only
  // path was hunting the command palette. The spark is now that click.
  onAcceptReview: (id: string) => void
  onPrefetch: (id: string) => void
  // The right-click menu for a row. The list owns when and where it opens; the caller
  // owns what it offers, so its handlers reach the menu without passing through here.
  // Must be identity-stable (useStableCallback in App) — the list is memoized.
  renderMenu: (menu: MenuState, close: () => void) => React.ReactNode
  // Optional viewport tracking: the scroll pane each row observes against and a callback
  // reporting when a row enters or leaves it, so App can gate auto-match to the rows on screen.
  scrollRootRef?: RefObject<HTMLElement | null>
  onVisible?: (id: string, visible: boolean) => void
  // Row buttons by track id, kept current as rows mount/unmount, so App can focus
  // and measure rows without querying the DOM by test id.
  rowRegistry?: RefObject<Map<string, HTMLButtonElement>>
  // When each file was last backed up (lib/trashView latestBackupByPath), so a row can
  // mark a track Surco keeps a backup of, and what clicking that mark opens.
  backupAtByPath?: ReadonlyMap<string, number>
  onOpenBackup?: (track: TrackItem) => void
}

export type MenuState = { track: TrackItem; x: number; y: number }

// Rows below this count all get painted up front (see the content-visibility note on the
// row wrapper): a small crate scrolls over already-rasterized content instead of paying
// each row's first paint mid-scroll. Past it, skipping off-screen work wins again.
const DEFER_PAINT_MIN_ROWS = 150

// Two-finger swipe to remove, the way Mail deletes. A trackpad sends the swipe as wheel
// events with deltaX and keeps sending momentum after the fingers lift, so the row settles
// once the events stop: past half its width (never under two actions' width) it is removed,
// past half the action it stays open on Remove, anything less springs back. What the row does
// on screen says which of those letting go will do: past the action it resists while the swipe
// is undecided, and once it would remove, the grey fills the row to its edge and no further.
// The thresholds read the swipe itself, not how far the row moved.
const SWIPE_GAP_PX = 6
const SWIPE_ACTION_PX = 84 + SWIPE_GAP_PX
const SWIPE_REMOVE_MIN_PX = SWIPE_ACTION_PX * 2
const SWIPE_SETTLE_MS = 160
const SWIPE_RESISTANCE = 0.35

// A hollow ring, not a filled dot: the conversion state shares the amber/red palette with
// the quality stripe/glyph on the same row, so a solid coin read as a second alarm. As a
// thin outline it still carries its colour but sits back a weight, keeping the two axes —
// conversion (this corner) and quality (the left stripe) — from competing.
const badgeBase =
  'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-[var(--color-ink)] ring-2 ring-[var(--color-ink)]'

// Amber is kept for what needs the user (here, changes not yet applied); a running
// conversion needs nothing from them, so it pulses in the accent instead.
const badgeTone = {
  attention: 'border-warn',
  busy: 'animate-pulse border-[var(--color-accent)]',
} as const

function ToneBadge({ tone }: { tone: keyof typeof badgeTone }): React.JSX.Element {
  return (
    <span
      data-testid="track-status-badge"
      data-tone={tone}
      className={`${badgeBase} ${badgeTone[tone]}`}
    />
  )
}

function StatusBadge({
  track,
  stale,
}: {
  track: TrackItem
  stale: boolean
}): React.JSX.Element | null {
  // Stale wins over done: a converted track edited afterwards shows steady amber so
  // pending Updates stay visible and can be batched for later.
  if (stale) return <ToneBadge tone="attention" />
  // done lands as a check on a Tokyo Night accent coin — an unmistakable "converted" mark,
  // set apart from the ring states by its shape and fill. The check uses the ink token so it
  // keeps contrast on the accent in both the light and dark themes.
  if (track.status === 'done')
    return (
      <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-ink)]">
        <Check aria-hidden className="h-2.5 w-2.5 text-[var(--color-ink)]" strokeWidth={3} />
      </span>
    )
  // idle is the default for nearly every imported row, so a constant dot says nothing; a clean
  // corner now reads as "not converted yet" and lets the live states stand out.
  if (track.status === 'idle') return null
  if (track.status === 'processing') return <ToneBadge tone="busy" />
  // A failure gets its own glyph, not just a red ring: the ring alone differed from the
  // amber "unapplied changes" one only by colour, which colour-blind users can't separate.
  return (
    <span
      data-testid="track-status-badge"
      data-tone="danger"
      className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-ink)] ring-2 ring-[var(--color-ink)]"
    >
      <CircleAlert
        data-testid="track-status-error-glyph"
        aria-hidden
        className="h-3.5 w-3.5 text-danger"
        strokeWidth={2.5}
      />
    </span>
  )
}

// The verdicts that actually render a glyph — every TrackQuality except 'unanalyzed',
// which the row leaves blank (guarded before QualityPill is reached).
type RowVerdict = Exclude<TrackQuality, 'unanalyzed'>

// The quality verdict reads as a distinct severity glyph, not a second colored dot, so it
// can't be mistaken for the round conversion-status light on the cover corner (both share the
// green/amber/red palette). good stays a quiet check; red is kept for the measured defects
// (bad, transcoded) and a possible reprocessing is a suspicion, so it takes amber.
type RowTone = 'good' | 'warn' | 'danger'

const qualityTone: Record<RowVerdict, RowTone> = {
  good: 'good',
  warn: 'warn',
  bad: 'danger',
  processed: 'warn',
  transcoded: 'danger',
}

// Solid shapes, not outlined icons: two 12px outlines side by side (sparkle and verdict)
// read as clutter. Each shape is sized to the same optical weight so a column of them
// scans evenly, and the shape alone tells the verdicts apart for colour-blind users:
// circle good, triangle suspicion, square measured defect. The colour sits on the wrapper
// and the shape paints currentColor, so it always matches the pill's label.
const qualityShape: Record<RowTone, React.JSX.Element> = {
  good: <circle cx="6" cy="6" r="3.5" />,
  warn: (
    <path d="M6 1.4 10.8 10H1.2Z" strokeLinejoin="round" strokeWidth="1.2" stroke="currentColor" />
  ),
  danger: <rect x="2" y="2" width="8" height="8" rx="1.8" />,
}

const qualityPill: Record<RowTone, string> = {
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/20 text-warn',
  danger: 'bg-danger/20 text-danger',
}

const qualityLabel: Record<RowVerdict, string> = {
  good: 'editor.qualityGood',
  warn: 'editor.qualitySuspect',
  bad: 'editor.qualityBad',
  processed: 'editor.qualityProcessed',
  transcoded: 'editor.qualityTranscode',
}

// The same verdict as a colour stripe down the row's left edge: ambient, scannable severity
// you read without parsing the small glyph at the right. good is deliberately absent: a clean
// file needs no mark, so a page of good rows stays calm.
const stripeClass: Record<Exclude<RowTone, 'good'>, string> = {
  warn: 'bg-warn',
  danger: 'bg-danger',
}

// The verdict tints the format pill instead of taking a slot of its own, so the artist keeps
// that width (artexjay 24/09). Amber and red keep their shape inside the pill, since colour
// alone can't separate them for a colour-blind user; a clean pill goes bare so a good album
// doesn't fill with symbols. Without a format to tint, the shape stands alone, good included.
function QualityPill({
  verdict,
  format,
  label,
}: {
  verdict: RowVerdict
  format: string | undefined
  label: string
}): React.JSX.Element {
  const tone = qualityTone[verdict]
  return (
    <span
      data-testid="track-quality"
      data-quality={verdict}
      data-tone={tone}
      className={`group/dot relative flex h-4 items-center gap-[3px] rounded px-[5px] ${qualityPill[tone]}`}
    >
      {(tone !== 'good' || !format) && (
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2 w-2" fill="currentColor">
          {qualityShape[tone]}
        </svg>
      )}
      {format && (
        <span data-testid="track-format" className="text-[10px] font-semibold leading-4">
          {format}
        </span>
      )}
      <Tooltip label={label} align="end" scope="dot" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

// The match sparkle as one solid four-point star, the same family and optical weight as the
// quality shapes beside it. An applied auto-match is the normal state of most rows after a
// sweep, so it takes the muted text colour; only the review one keeps a colour of its own,
// because that is the one asking the user to act.
function Spark(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
      <path d="M6 .6Q6.7 5.3 11.4 6 6.7 6.7 6 11.4 5.3 6.7.6 6 5.3 5.3 6 .6Z" />
    </svg>
  )
}

// Appends the match's confidence ("· 96%") to the tooltip so hovering the row surfaces how
// strong the auto-match was. Hand-picked matches carry no confidence, so the label stands alone.
function matchTooltip(label: string, confidence: number | undefined): string {
  return confidence === undefined ? label : `${label} · ${Math.round(confidence * 100)}%`
}

// The single row tooltip: the frozen list label and the artist, joined only when both read.
// Uses listLabel (not meta.title) so it matches the row, and falls back to the "no artist"
// placeholder the row itself shows.
function rowTooltip(t: TrackItem, tr: (key: string) => string): string {
  const artist = t.meta.artist || tr('trackList.noArtist')
  return `${t.listLabel} · ${artist}`
}

interface RowProps {
  track: TrackItem
  bindings: Map<string, Chord>
  selected: boolean
  primary: boolean
  // Whether this row holds the listbox's single tab stop (roving tabindex): the primary
  // row, or the first row while nothing is selected yet.
  tabbable: boolean
  // Whether the list is long enough to skip painting off-screen rows (DEFER_PAINT_MIN_ROWS).
  // A flag rather than the list's length, so a row only re-renders when it flips.
  deferPaint: boolean
  outputFormat: OutputFormat
  onSelect: (id: string, mods: ClickMods) => void
  onActivate: (track: TrackItem) => void
  onSwipeRemove: (id: string) => void
  // Applies the row's pending review-tier suggestion — the mouse half of the
  // accept-review command. The sweep stored the release for one-action acceptance
  // (useAutoMatch: "shortcut or click"), but the click never existed: the amber
  // spark was inert, and accept-review ships with no default chord, so the only
  // path was hunting the command palette. The spark is now that click.
  onAcceptReview: (id: string) => void
  // Plain ⌫/Supr on the focused row — the keyboard ✕. Separate from onRemove because
  // the list must also hop selection/focus to a surviving neighbour (see TrackList).
  onRemoveKey: (id: string) => void
  // Shift+↑/↓ on the focused row: extends the range to its neighbour in that direction.
  onExtendKey: (id: string, delta: 1 | -1) => void
  onPrefetch: (id: string) => void
  onOpenMenu: (track: TrackItem, x: number, y: number) => void
  // Starts the native drag-out for this row (all selected files when it's part of the
  // selection, just this one otherwise). Stable, so the memoized rows don't re-render.
  onDragOut: (track: TrackItem) => void
  // Registers the row with the list's shared IntersectionObserver; returns the
  // unobserve cleanup. Undefined when the list doesn't track visibility.
  observeRow?: (el: Element, onVisible: (visible: boolean) => void) => () => void
  onVisible?: (id: string, visible: boolean) => void
  rowRegistry?: RefObject<Map<string, HTMLButtonElement>>
  backupAt?: number
  onOpenBackup?: (track: TrackItem) => void
}

// Memoized so a progress event — which replaces only the updated track's object
// while every other row keeps its identity — re-renders that one row instead of
// the whole list. Relies on App passing stable onSelect/onSwipeRemove.
const TrackRow = memo(function TrackRow({
  track: t,
  bindings,
  selected,
  primary,
  tabbable,
  deferPaint,
  outputFormat,
  onSelect,
  onActivate,
  onSwipeRemove,
  onAcceptReview,
  onRemoveKey,
  onExtendKey,
  onPrefetch,
  onOpenMenu,
  onDragOut,
  observeRow,
  onVisible,
  rowRegistry,
  backupAt,
  onOpenBackup,
}: RowProps): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const quality = trackQuality(t)
  // isStale JSON.stringifies the track's meta; computing it once per row and
  // threading it to the badge and the tooltip avoids paying that serialization twice on
  // every render of a converted row.
  const stale = isStale(t)
  // Source format read off the input path — the parsed fileName drops its extension —
  // so a mixed crate (WAV rips next to bought MP3s) can be scanned for what still
  // needs a conversion without opening each track. Shared with the per-format filter
  // and sort, so the pill, the filter chip and the sort order all agree.
  const format = sourceFormat(t)
  const backupLabel =
    backupAt === undefined
      ? ''
      : tr('trackList.backup', {
          when: new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(backupAt),
        })
  const rowRef = useRef<HTMLDivElement>(null)
  const [swipe, setSwipe] = useState(0)
  const swipeRef = useRef(0)
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settleRef.current), [])
  const swipeBounds = (): { width: number; removeAt: number } => {
    const width = rowRef.current?.offsetWidth ?? 0
    return { width, removeAt: Math.max(SWIPE_REMOVE_MIN_PX, width / 2) }
  }
  const moveSwipe = (px: number): void => {
    swipeRef.current = px
    const { width, removeAt } = swipeBounds()
    setSwipe(
      px >= removeAt
        ? Math.max(width, removeAt)
        : px <= SWIPE_ACTION_PX
          ? px
          : SWIPE_ACTION_PX + (px - SWIPE_ACTION_PX) * SWIPE_RESISTANCE,
    )
  }
  const onSwipeWheel = (e: React.WheelEvent): void => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const { removeAt } = swipeBounds()
    moveSwipe(Math.min(Math.max(swipeRef.current + e.deltaX, 0), removeAt * 1.5))
    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(() => {
      const reached = swipeRef.current
      moveSwipe(reached >= removeAt || reached < SWIPE_ACTION_PX / 2 ? 0 : SWIPE_ACTION_PX)
      if (reached >= removeAt) onSwipeRemove(t.id)
    }, SWIPE_SETTLE_MS)
  }
  const closeSwipe = (): void => {
    clearTimeout(settleRef.current)
    moveSwipe(0)
  }
  const reviewPending = !t.autoMatched && t.matchReview && !t.matched
  const stage = t.status === 'processing' ? t.stage : undefined
  const converting = stage !== undefined
  // Shared by each mark's hover tooltip and its sr-only twin, so what a screen reader
  // hears is the same sentence the pointer reveals.
  const statusLabel = tr(stale ? 'trackList.status.stale' : `trackList.status.${t.status}`)
  const autoMatchLabel = matchTooltip(
    t.matchProvider
      ? tr('trackList.autoMatchedFrom', { source: tr(`settings.provider.${t.matchProvider}`) })
      : tr('trackList.autoMatched'),
    t.matchConfidence,
  )
  // Report this row entering/leaving the scroll pane so App can run auto-match for
  // what's on screen, through the list's single shared observer.
  useEffect(() => {
    const el = rowRef.current
    if (!onVisible || !observeRow || !el) return
    return observeRow(el, (visible) => onVisible(t.id, visible))
  }, [t.id, onVisible, observeRow])
  // Every selected row gets the soft fill; only the primary (the one in the editor)
  // wears the accent bar, so a multi-selection still shows which track is being edited.
  return (
    // Drag lives on the row wrapper, not the button: Chromium won't reliably start a native
    // drag from a <button> (its press state swallows the dragstart), so the row could
    // not be picked up at all. The img-based cover never hit this, hence the divergence.
    // biome-ignore lint/a11y/noStaticElementInteractions: the drag must live on the row wrapper (Chromium won't start a native drag from a button); the row's interactive semantics are on the inner role="option" button
    <div
      ref={rowRef}
      // Presentational: the listbox semantics live on the button below (role="option"),
      // so the drag-hosting wrapper drops out of the accessibility tree.
      role="presentation"
      // content-visibility lets the browser skip layout, paint and style for rows
      // scrolled out of the pane, so a 500-track crate doesn't pay that cost for the
      // ~490 rows off screen. The row stays in the DOM — unlike windowing — so keyboard
      // focus, the shared visibility observer and the rowEls measuring all keep working
      // untouched. contain-intrinsic-size feeds the scrollbar a height estimate for the
      // skipped rows; `auto` then remembers each row's real size once it has rendered.
      // Only worth it past DEFER_PAINT_MIN_ROWS: below that, deferring paint moves the
      // first-paint cost of each row into the scroll itself and reads as jank, while
      // painting the whole small list once keeps scrolling on already-rasterized content.
      className={`group relative ${
        deferPaint ? '[content-visibility:auto] [contain-intrinsic-size:auto_52px]' : ''
      }`}
      draggable
      onWheel={onSwipeWheel}
      onMouseLeave={closeSwipe}
      onDragStart={(e) => {
        // Hand the OS the untouched source file(s) so the row can be dropped onto Spek
        // or any app. An actual drag suppresses the click, so select and drag-out
        // don't fight (same arrangement the cover uses). The cover rides along so the
        // OS drag thumbnail is the track's own art, not a generic app icon.
        e.preventDefault()
        onDragOut(t)
      }}
    >
      <button
        type="button"
        ref={(el) => {
          if (!rowRegistry) return
          if (el) rowRegistry.current.set(t.id, el)
          else rowRegistry.current.delete(t.id)
        }}
        data-testid="track-row"
        style={swipe > 0 ? { transform: `translateX(-${swipe}px)` } : undefined}
        // El ámbito vive en la fila y no en un contenedor de la lista porque solo aquí se
        // maneja esta tecla: capturarla sobre el resto de controles la dejaría muerta en
        // vez de caer a su comando global.
        data-shortcut-scope="track-list"
        role="option"
        aria-selected={selected}
        // Several rows can be selected; this marks the one open in the editor, the fact
        // the solid fill carries for sighted users.
        aria-current={primary || undefined}
        // aria-setsize/aria-posinset are written by TrackList, not here: see its layout effect.
        // Roving tabindex: only the tab-stop row is reachable by Tab; the rest are driven
        // by the global ↑/↓ (and j/k) handler that focuses them as the selection moves.
        tabIndex={tabbable ? 0 : -1}
        onClick={(e) => {
          // The backup mark is part of the row (a button can't hold another), so its click
          // is told apart here: it opens the backup instead of only selecting the track.
          if (onOpenBackup && (e.target as Element).closest('[data-backup-mark]')) {
            onOpenBackup(t)
            return
          }
          onSelect(t.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })
        }}
        onKeyDown={(e) => {
          const chord = eventToChord(e, isMac)
          if (chord && matchChord(bindings, chord, false, 'track-list') === 'track-menu') {
            e.preventDefault()
            // The menu is positioned in pixels because it's normally born from a right
            // click; from the keyboard there are none, so anchor it to the row's own
            // bottom-left corner.
            const r = e.currentTarget.getBoundingClientRect()
            if (!selected) onSelect(t.id, {})
            onOpenMenu(t, r.left, r.bottom)
            return
          }
          // Shift+↑/↓ grows the range from the anchor, the keyboard twin of a Shift-click.
          // Claimed here even at the list's ends, or the global ↑/↓ would run "next"/"prev"
          // and collapse the range the user is building.
          const plainShift = e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
          if (plainShift && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            onExtendKey(t.id, e.key === 'ArrowDown' ? 1 : -1)
            return
          }
          // Plain Space plays, so ⌘Space / Ctrl+Space toggles the focused row in or out of
          // the selection without dropping the rest, like a ⌘-click.
          if (e.key === ' ' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
            e.preventDefault()
            onSelect(t.id, { meta: true })
            return
          }
          // Bare key only: ⌘⌫ belongs to the global remove command, and the list is a
          // no-typing surface so plain ⌫/Supr is unambiguous here.
          if (e.key !== 'Backspace' && e.key !== 'Delete') return
          if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
          e.preventDefault()
          onRemoveKey(t.id)
        }}
        onDoubleClick={() => onActivate(t)}
        onContextMenu={(e) => {
          e.preventDefault()
          // Make the right-clicked row the editor's track unless it's already part of
          // the current selection, so the menu's single-track actions are unambiguous.
          if (!selected) onSelect(t.id, {})
          onOpenMenu(t, e.clientX, e.clientY)
        }}
        onMouseEnter={() => onPrefetch(t.id)}
        onFocus={() => onPrefetch(t.id)}
        className={`group/row relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
          // A selected row paints its fill on the keystroke: ↑/↓ and j/k run through this
          // list constantly, and easing the fill in leaves the highlight a step behind the
          // cursor. Only the unselected rows animate their colours, where the transition
          // belongs to the hover tint and its mouse pace suits it. Every row eases its swipe
          // position, so crossing the remove threshold slides to the edge instead of jumping.
          selected
            ? 'transition-[transform] ease-out'
            : 'transition-[color,background-color,border-color,outline-color,transform] ease-out'
        } ${
          // The primary row (the one open in the editor) takes the selection fill, the way
          // Finder/Mail fill the active row. A multi-selected-but-not-primary row gets the
          // quieter accent tint. Everything else is bare: no outline and no fill of its own,
          // like the lists in Music or Mail, so the page of rows reads as one list instead of
          // a stack of cards, and only the hover tints it.
          primary
            ? 'is-primary bg-[var(--color-row-selected)]'
            : selected
              ? 'bg-[var(--color-accent-soft)]/85'
              : 'hover:bg-[var(--color-panel-2)]/85'
        } focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]`}
      >
        {/* Severity stripe at the left edge: ambient, scannable — a page of rows shows which
            ones want attention before you read a single glyph. Hidden on the primary row,
            whose solid-accent fill already owns that edge. */}
        {!primary && quality !== 'unanalyzed' && qualityTone[quality] !== 'good' && (
          <span
            aria-hidden="true"
            data-testid="track-quality-stripe"
            data-tone={qualityTone[quality]}
            className={`absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-full ${stripeClass[qualityTone[quality] as Exclude<RowTone, 'good'>]}`}
          />
        )}
        {/* The cover doubles as the scan target — DJs recognise a track by its art faster
            than by its name — so the leading slot shows the artwork with the processing
            status demoted to a small ringed dot on its corner. While a conversion runs the
            cover rounds into a disc and a ring closes round it phase by phase, the way the
            App Store draws a download, instead of a bar under the stage text. */}
        <span data-testid="track-status" className="group/dot relative shrink-0">
          {converting && (
            <span
              data-testid="track-progress-ring"
              aria-hidden="true"
              className="progress-ring"
              style={{ '--progress': STAGE_PROGRESS[stage] } as React.CSSProperties}
            />
          )}
          {t.embeddedCover ? (
            <img
              data-testid="track-cover"
              src={t.embeddedCover}
              alt=""
              // Covers are base64 JPEGs; without these two the browser decodes each one
              // synchronously on the main thread the moment its row is first painted —
              // which, combined with content-visibility below, lands mid-scroll and janks.
              loading="lazy"
              decoding="async"
              className={`h-8 w-8 object-cover outline outline-1 -outline-offset-1 outline-on-scrim/10 transition-[border-radius] duration-300 ${
                converting ? 'rounded-full' : 'rounded-md'
              }`}
            />
          ) : (
            <span
              data-testid="track-cover-placeholder"
              className={`flex h-8 w-8 items-center justify-center bg-[var(--color-panel-2)] outline outline-1 -outline-offset-1 outline-on-scrim/10 transition-[border-radius] duration-300 ${
                converting ? 'rounded-full' : 'rounded-md'
              }`}
            >
              <Music className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
            </span>
          )}
          {!converting && <StatusBadge track={t} stale={stale} />}
          <Tooltip label={statusLabel} align="start" scope="dot" />
          {/* The badge is an unlabelled shape and the tooltip only shows on hover, so the
              state is spoken from here. Idle draws no badge and stays silent too. */}
          {(stale || t.status !== 'idle') && <span className="sr-only">{statusLabel}</span>}
        </span>
        {/* The row tooltip (frozen listLabel — not the editable meta.title — so it matches
            what the row shows) is scoped to the text itself, not this flex-1 layout slot:
            anchored to the slot, it fired across the whole empty tail to the right of a
            short title. Each text line carries its own copy, each width-fit to its words, so
            hovering the gap beside the text raises nothing. The two never double up — a fit
            title and a fit artist don't overlap, and the vertical gap between the stacked
            lines belongs to neither. */}
        <span data-fit className="relative min-w-0 flex-1">
          {/* The duration rides the title line, the way Mail puts the time beside the
              sender: on the artist line it was one of six fixed columns that left the
              artist a few letters. */}
          <span data-testid="track-title-line" className="flex items-center gap-2">
            <span className="relative block min-w-0 flex-1 truncate">
              <span className="relative block w-fit max-w-full truncate text-sm font-medium text-fg">
                <Tooltip label={rowTooltip(t, tr)} />
                {t.listLabel}
              </span>
            </span>
            <span
              data-testid="track-duration-slot"
              className="w-[34px] shrink-0 text-right text-xs tabular-nums text-fg-dim"
            >
              {t.duration !== undefined && (
                <span data-testid="track-duration">{formatTime(t.duration)}</span>
              )}
            </span>
          </span>
          {t.loadingMeta ? (
            <span
              data-testid="track-loading"
              className="mt-2 block h-2.5 w-28 animate-pulse rounded bg-[var(--color-panel-2)]"
            />
          ) : converting ? (
            <span data-testid="track-stage" className="mt-0.5 block">
              <span className="block truncate text-xs text-[var(--color-accent)]">
                {tr(`trackList.stage.${stage}`, {
                  format: (t.format ?? outputFormat).toUpperCase(),
                })}
              </span>
              {/* Text, not role="progressbar": an option's children are presentational,
                  so a nested role would be flattened away and the amount never spoken. */}
              <span className="sr-only">
                {tr('trackList.progress', { percent: Math.round(STAGE_PROGRESS[stage] * 100) })}
              </span>
            </span>
          ) : (
            <span data-testid="track-detail-line" className="flex items-center gap-2">
              <span className="relative block min-w-0 flex-1 truncate text-xs text-fg-dim">
                <span className="relative block w-fit max-w-full truncate">
                  <Tooltip label={rowTooltip(t, tr)} />
                  {t.meta.artist || tr('trackList.noArtist')}
                </span>
              </span>
              {/* A failed tag read leaves the row showing only its file-name parse; the mark
                  tells that apart from a file that genuinely carries no tags. */}
              {t.metaReadFailed && (
                <span
                  data-testid="track-meta-failed"
                  className="group/dot relative flex shrink-0 items-center text-warn"
                >
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  <Tooltip label={tr('trackList.metaReadFailed')} align="end" scope="dot" />
                  <span className="sr-only">{tr('trackList.metaReadFailed')}</span>
                </span>
              )}
              {backupAt !== undefined && (
                <span
                  data-testid="track-backup"
                  data-backup-mark
                  className="group/dot relative flex shrink-0 items-center text-fg-faint"
                >
                  <Undo2 className="h-3 w-3" aria-hidden="true" />
                  <Tooltip label={backupLabel} align="end" scope="dot" />
                  <span className="sr-only">{backupLabel}</span>
                </span>
              )}
              {t.autoMatched ? (
                <span
                  data-testid="track-automatched"
                  data-confidence="high"
                  className="group/dot relative flex shrink-0 items-center text-fg-dim"
                >
                  <Spark />
                  <Tooltip label={autoMatchLabel} align="end" scope="dot" />
                  <span className="sr-only">{autoMatchLabel}</span>
                </span>
              ) : (
                reviewPending && <span className="w-3 shrink-0" />
              )}
              {/* A fixed slot, right-aligned under the duration, so the two read as one
                  trailing column and the review sparkle's place never moves. Wide enough for
                  the pill with its shape, so a tinted FLAC and a bare MP3 end on the same edge. */}
              <span data-testid="track-format-slot" className="flex w-[46px] shrink-0 justify-end">
                {quality !== 'unanalyzed' ? (
                  <QualityPill
                    verdict={quality}
                    format={format}
                    label={tr(qualityLabel[quality])}
                  />
                ) : t.analyzing ? (
                  <span
                    data-testid="track-quality-loading"
                    className="group/dot relative flex h-4 animate-pulse items-center rounded px-[5px] text-fg-faint ring-1 ring-current ring-inset"
                  >
                    {format ? (
                      <span className="text-[10px] font-semibold leading-4">{format}</span>
                    ) : (
                      <span className="h-2 w-2 rounded-full ring-[1.5px] ring-current ring-inset" />
                    )}
                    <Tooltip label={tr('editor.analyzing')} align="end" scope="dot" />
                  </span>
                ) : (
                  format && (
                    <span
                      data-testid="track-format"
                      className="text-[10px] font-medium leading-4 text-fg-dim"
                    >
                      {format}
                    </span>
                  )
                )}
              </span>
            </span>
          )}
        </span>
      </button>
      {/* A review-tier suggestion the user hasn't acted on yet: amber, distinct from the
          applied accent sparkle, and gone the moment the track is actually matched. A
          sibling of the row button, not a child, since a button inside the option button
          is invalid and folds the action into the row's name. It is placed over the empty
          slot the artist line keeps for it before the pill: that slot ends 64px from the
          right edge (the row padding, the 46px pill slot and its gap), and its centre sits
          17px up from the bottom. The button is a 24px target (WCAG 2.5.8) centred there,
          so the 12px glyph lands where the slot would have drawn it. Shown under the same
          conditions as that line. */}
      {!t.loadingMeta && !converting && reviewPending && swipe === 0 && (
        <button
          type="button"
          data-testid="track-match-review"
          data-confidence="review"
          aria-label={tr('commands.acceptReview')}
          onClick={() => onAcceptReview(t.id)}
          className="group/dot press absolute right-[58px] bottom-[5px] flex h-6 w-6 items-center justify-center text-warn"
        >
          <Spark />
          <Tooltip
            label={matchTooltip(tr('commands.acceptReview'), t.matchConfidence)}
            align="end"
            scope="dot"
          />
        </button>
      )}
      {/* A ▶ overlay over the cover makes play discoverable — double-click and Space are
          the only other ways in, and neither shows itself. A sibling of the row button
          (not a child) so it stays a valid nested-button-free control, like Remove.
          Not a Tab stop: it is invisible until hovered, and the row itself already
          answers Space. Gone while the row is swiped aside, since the cover moved. */}
      {swipe === 0 && (
        <button
          type="button"
          aria-label={tr('player.play')}
          tabIndex={-1}
          onClick={() => onActivate(t)}
          // No backdrop-blur here: with one of these per row, Chromium promotes every
          // overlay to a render surface even at opacity-0, and dozens of backdrop-filter
          // layers inside the scroller are a known compositor jank source. A slightly
          // denser plain fill keeps the glyph readable over any cover.
          className="absolute top-1/2 left-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md bg-scrim/65 text-on-scrim opacity-0 transition-opacity pointer-events-none hover:bg-scrim/75 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          <Play className="h-4 w-4 fill-current" aria-hidden="true" />
        </button>
      )}
      {/* What the swipe uncovers, in the strip the row slid out of. Grey, not Mail's red:
          it takes the track off the list and leaves the file alone. Not a Tab stop, like
          play: ⌫/Supr on the row is the keyboard's way to the same thing. */}
      {swipe > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onSwipeRemove(t.id)}
          style={{ width: Math.max(swipe - SWIPE_GAP_PX, 0) }}
          className="absolute inset-y-1 right-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg bg-[var(--color-swipe-action)] transition-[width] ease-out text-[11px] font-semibold whitespace-nowrap text-[var(--color-on-swipe-action)]"
        >
          <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {tr('trackList.remove')}
        </button>
      )}
    </div>
  )
})

// Memoized so App re-renders (a toast, a progress tick, a modal open) that don't
// touch the visible tracks skip re-mapping and re-diffing every row — the rows
// themselves are already memoized (see TrackRow above), but without this the list
// still re-ran its full render body on every App render. Relies on every function
// prop below being stable (App/useTrackLibrary/useAutoMatch use useStableCallback
// or a dependency-correct useCallback for all of them).
export const TrackList = memo(function TrackList({
  tracks,
  selectedId,
  selectedIds,
  outputFormat,
  bindings,
  onSelect,
  onActivate,
  onRemove,
  onSwipeRemove,
  onAcceptReview,
  onPrefetch,
  renderMenu,
  scrollRootRef,
  onVisible,
  rowRegistry,
  backupAtByPath,
  onOpenBackup,
}: Props): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  // The keyboard ✕ (plain ⌫/Supr on a focused row). Removal deselects, which would
  // strand the keyboard on a dead row: hop selection — and focus, via the registry —
  // to the first row OUTSIDE the doomed set (onRemove is selection-aware in App), so
  // ⌫ ⌫ ⌫ walks down the list like Finder's delete does.
  const removeViaKeyboard = useStableCallback((id: string): void => {
    const doomed = selectedIds.has(id) ? selectedIds : new Set([id])
    const i = tracks.findIndex((t) => t.id === id)
    const neighbor =
      tracks.slice(i + 1).find((t) => !doomed.has(t.id)) ??
      tracks
        .slice(0, Math.max(i, 0))
        .reverse()
        .find((t) => !doomed.has(t.id))
    onRemove(id)
    if (neighbor) {
      onSelect(neighbor.id, {})
      rowRegistry?.current?.get(neighbor.id)?.focus()
    }
  })
  // The moving end of a keyboard range is the focused row, not the anchor: the anchor stays
  // the editor's track (as with a Shift-click), and the focus hops to the new end so the
  // next Shift+↑/↓ keeps growing or shrinking the same range.
  const extendViaKeyboard = useStableCallback((id: string, delta: 1 | -1): void => {
    const to = tracks[tracks.findIndex((t) => t.id === id) + delta]
    if (!to) return
    onSelect(to.id, { shift: true })
    rowRegistry?.current?.get(to.id)?.focus()
  })
  // Stable so the memoized rows don't all re-render when the menu opens/closes.
  const openMenu = useCallback(
    (track: TrackItem, x: number, y: number) => setMenu({ track, x, y }),
    [],
  )
  const closeMenu = useCallback(() => setMenu(null), [])
  // Reads the live selection at drag time through a ref, so the handler stays stable and
  // the memoized rows don't all re-render whenever the selection changes.
  const dragState = useRef({ tracks, selectedIds })
  dragState.current = { tracks, selectedIds }
  const startDragOut = useCallback((track: TrackItem): void => {
    const { tracks, selectedIds } = dragState.current
    // Dragging a row that's part of the selection drags the whole selection (Finder's
    // convention); dragging an unselected row drags just that one. List order is kept.
    const paths = selectedIds.has(track.id)
      ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.inputPath)
      : [track.inputPath]
    // The OS drag thumbnail is the file's own art, matching the row — never the cover
    // the user dropped into the editor form, which lives on the live coverUrl.
    window.api.startTrackDrag(paths, track.embeddedCover)
  }, [])
  // One IntersectionObserver for the whole list instead of one per row — 500 rows
  // used to mean 500 observer instances doing identical work against the same root.
  // Created lazily on the first row registration so the scroll pane's ref is bound;
  // rootMargin warms rows a little before they're scrolled fully into view.
  const rowVisibility = useRef(new Map<Element, (visible: boolean) => void>())
  const rowObserver = useRef<IntersectionObserver | null>(null)
  const observeRow = useCallback(
    (el: Element, report: (visible: boolean) => void): (() => void) => {
      if (typeof IntersectionObserver === 'undefined') return () => {}
      if (!rowObserver.current) {
        rowObserver.current = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              rowVisibility.current.get(entry.target)?.(entry.isIntersecting)
            }
          },
          { root: scrollRootRef?.current ?? null, rootMargin: '300px 0px' },
        )
      }
      rowVisibility.current.set(el, report)
      rowObserver.current.observe(el)
      return () => {
        rowVisibility.current.delete(el)
        rowObserver.current?.unobserve(el)
      }
    },
    [scrollRootRef],
  )
  useEffect(() => () => rowObserver.current?.disconnect(), [])
  // The rows are real DOM (content-visibility, not windowing), but a screen reader still
  // benefits from an explicit "row 12 of 500" as filters shrink the set. Written straight
  // onto the options rather than passed as props: the size changes with every import batch,
  // and as a prop it re-rendered every memoized row on each one.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const options = listRef.current?.querySelectorAll('[role="option"]') ?? []
    options.forEach((option, i) => {
      option.setAttribute('aria-setsize', String(tracks.length))
      option.setAttribute('aria-posinset', String(i + 1))
    })
  }, [tracks])
  const { t: tr } = useTranslation()
  return (
    <>
      <div
        ref={listRef}
        role="listbox"
        aria-label={tr('trackList.label')}
        aria-multiselectable="true"
        className="flex flex-col gap-0.5 p-2"
      >
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            bindings={bindings}
            selected={selectedIds.has(t.id)}
            primary={t.id === selectedId}
            // The selection owns the single tab stop; with nothing selected the first row
            // holds it so the list stays reachable by Tab.
            tabbable={t.id === selectedId || (selectedId === null && i === 0)}
            deferPaint={tracks.length >= DEFER_PAINT_MIN_ROWS}
            outputFormat={outputFormat}
            onSelect={onSelect}
            onActivate={onActivate}
            onSwipeRemove={onSwipeRemove}
            onAcceptReview={onAcceptReview}
            onRemoveKey={removeViaKeyboard}
            onExtendKey={extendViaKeyboard}
            onPrefetch={onPrefetch}
            onOpenMenu={openMenu}
            onDragOut={startDragOut}
            observeRow={observeRow}
            onVisible={onVisible}
            rowRegistry={rowRegistry}
            backupAt={backupAtByPath?.get(t.inputPath)}
            onOpenBackup={onOpenBackup}
          />
        ))}
      </div>
      {menu && renderMenu(menu, closeMenu)}
    </>
  )
})
