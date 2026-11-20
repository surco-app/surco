import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import type { CueFlow } from '../../../shared/cueFlows'
import { rejectedCues } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import { foldAccents } from '../../../shared/foldAccents'
import type { TrackCues } from '../../../shared/types'
import { readPlaylist } from '../hooks/useSourceBrowser'
import { useTrackCues } from '../hooks/useTrackCues'
import {
  collectionChoices,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  EXAMPLE_POINT_BAR,
  EXAMPLE_TRACK,
  EXAMPLE_WAVE,
  examplePlan,
  hotDiff,
  samePosition,
  trackOfCues,
  trackPlan,
} from '../lib/cueExample'
import { LIBRARY_NAME } from '../lib/reviewLibraries'
import { clipBox, MENU_GAP } from './CueRuleRow'
import { CueWave } from './CueWave'
import { SegmentedControl } from './SegmentedControl'
import { showOption } from './Select'
import { Tooltip } from './Tooltip'

type Source = 'track' | 'example'
type Mode = 'flow' | 'now'

const MODES: readonly Mode[] = ['flow', 'now']

type Status = 'too-many' | 'trimmed' | 'compare' | 'no-mark' | 'hint'

const NOTICE_TEXT: Record<Status, string> = {
  'too-many': 'text-xs text-warn',
  trimmed: 'text-xs text-fg-dim',
  compare: 'text-xs text-warn',
  'no-mark': 'text-label text-fg-dim',
  hint: 'text-label text-fg-dim',
}

interface Choice {
  contentId: string
  label: string
  artist?: string
}

const NO_CHOICES: Choice[] = []
const NO_PROGRAMS: readonly DjProgram[] = []
const MAX_CHOICES = 100
const OPTION =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-[var(--color-hover)]'

const PROGRAM =
  'press min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg aria-checked:bg-[var(--color-panel-2)] aria-checked:text-fg aria-checked:shadow-[inset_0_0_0_1px_var(--color-line-strong)]'

const folded = (text: string): string => foldAccents(text).toLowerCase()

function TrackChoices({
  choices,
  programs,
  program,
  onProgram,
  loading,
  inUse,
  onChoose,
  onClose,
}: {
  choices: Choice[]
  programs: readonly DjProgram[]
  program: DjProgram
  onProgram: (program: DjProgram) => void
  loading: boolean
  inUse: string | null
  onChoose: (choice: Choice | null) => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const exampleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const byKeys = useRef(false)
  const wanted = folded(query.trim())
  const found = choices
    .filter((c) => folded(`${c.label} ${c.artist ?? ''}`).includes(wanted))
    .slice(0, MAX_CHOICES)
  const searchable = loading || choices.length > 0
  const searchLabel = tr('settings.cueFlows.searchCollection', { program: LIBRARY_NAME[program] })

  useEffect(() => {
    if (byKeys.current && rowRef.current?.contains(document.activeElement)) return
    const first = searchable ? searchRef.current : exampleRef.current
    first?.focus({ preventScroll: true })
  }, [searchable])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || loading) return
    const box = menu.getBoundingClientRect()
    const clip = clipBox(menu)
    const below = box.top + (menu.offsetHeight || box.height) + MENU_GAP - clip.bottom
    if (below > 0 && clip.scroller) clip.scroller.scrollTop += Math.ceil(below)
  }, [loading])

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    )
    const next =
      items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)
    if (next < 0) searchRef.current?.focus({ preventScroll: true })
    else if (next < items.length) showOption(listRef.current, items[next])
  }

  function look(next: DjProgram, keys: boolean): void {
    byKeys.current = keys
    setQuery('')
    onProgram(next)
  }

  function onProgramKey(e: React.KeyboardEvent<HTMLButtonElement>, at: number): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      onKeyDown(e)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const next = (at + (e.key === 'ArrowRight' ? 1 : programs.length - 1)) % programs.length
    look(programs[next], true)
    rowRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      ref={menuRef}
      data-testid="cue-preview-track-menu"
      className="animate-pop-flat absolute inset-x-0 top-full z-20 mt-1 origin-top rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
    >
      {programs.length > 1 && (
        <div
          ref={rowRef}
          role="radiogroup"
          aria-label={tr('settings.cueFlows.previewProgram')}
          className="mb-1 flex gap-0.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] p-[3px]"
        >
          {programs.map((p, at) => (
            // biome-ignore lint/a11y/useSemanticElements: a program is a segment of the row; a native radio input cannot draw it and the arrows and roving tab stop are handled here
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={p === program}
              tabIndex={p === program ? 0 : -1}
              data-testid={`cue-preview-program-${p}`}
              onClick={() => {
                look(p, false)
                searchRef.current?.focus({ preventScroll: true })
              }}
              onKeyDown={(e) => onProgramKey(e, at)}
              className={PROGRAM}
            >
              {LIBRARY_NAME[p]}
            </button>
          ))}
        </div>
      )}
      {searchable && (
        <input
          ref={searchRef}
          data-testid="cue-preview-track-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="mb-1 h-7 w-full min-w-0 border-b border-[var(--color-line)] bg-transparent px-2 text-xs text-fg outline-none focus-visible:shadow-none placeholder:text-fg-faint"
        />
      )}
      <div
        ref={listRef}
        role="listbox"
        data-testid="cue-preview-track-listbox"
        aria-label={tr('settings.cueFlows.preview')}
        onKeyDown={onKeyDown}
        className="relative max-h-56 overflow-y-auto"
      >
        <button
          ref={exampleRef}
          type="button"
          role="option"
          aria-selected={inUse === null}
          data-testid="cue-preview-track-option-example"
          onClick={() => onChoose(null)}
          className={OPTION}
        >
          <span className="min-w-0 flex-1 truncate">{tr('settings.cueFlows.exampleTrack')}</span>
          <Check
            aria-hidden="true"
            className={`size-3 shrink-0 ${inUse === null ? '' : 'invisible'}`}
          />
        </button>
        {searchable && (
          <hr
            data-testid="cue-preview-track-separator"
            className="my-1 h-px border-0 bg-[var(--color-line)]"
          />
        )}
        {found.map((c) => (
          <button
            key={c.contentId}
            type="button"
            role="option"
            aria-selected={c.contentId === inUse}
            data-testid={`cue-preview-track-option-${c.contentId}`}
            onClick={() => onChoose(c)}
            className={OPTION}
          >
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            {c.artist && (
              <span
                data-testid={`cue-preview-track-artist-${c.contentId}`}
                className="max-w-[40%] shrink-0 truncate text-fg-dim"
              >
                {c.artist}
              </span>
            )}
            <Check
              aria-hidden="true"
              className={`size-3 shrink-0 ${c.contentId === inUse ? '' : 'invisible'}`}
            />
          </button>
        ))}
      </div>
      {loading && (
        <p
          role="status"
          data-testid="cue-preview-track-loading"
          aria-label={tr('settings.cueFlows.loadingTracks')}
          className="flex h-7 items-center px-2 text-fg-dim"
        >
          <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin" />
        </p>
      )}
      {choices.length > 0 && found.length === 0 && (
        <p data-testid="cue-preview-track-empty" className="px-2 py-1.5 text-xs text-fg-dim">
          {tr('settings.cueFlows.noTrackFound')}
        </p>
      )}
    </div>
  )
}

export function CueFlowPreview({
  flow,
  track,
  tracks = NO_CHOICES,
  programs = NO_PROGRAMS,
  program = 'rekordbox',
  onProgram,
  loading = false,
  onPick,
  onOpenChange,
  onShown,
}: {
  flow: CueFlow
  track?: { label: string; cues: TrackCues }
  tracks?: Choice[]
  programs?: readonly DjProgram[]
  program?: DjProgram
  onProgram?: (program: DjProgram) => void
  loading?: boolean
  onPick?: (choice: Choice) => void
  onOpenChange?: (open: boolean) => void
  onShown?: (shown: { label: string; cues: TrackCues } | null) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [source, setSource] = useState<Source>('track')
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const real = track?.cues.analysed ? trackOfCues(track.cues) : null
  const marked = real !== null && real.drops.length > 0
  const onTrack = track !== undefined && real !== null && marked && source === 'track'
  const base = onTrack ? real : EXAMPLE_TRACK
  const out = onTrack ? trackPlan(flow, real) : examplePlan(flow)
  const cues =
    out.status === 'too-many'
      ? []
      : out.wanted.map((c, i) => ({ ...c, key: `${i}`, pending: false }))
  const leftOut = rejectedCues(flow, base).filter((c) => c.reason !== 'limit')
  const has = onTrack ? track.cues.cues.filter((c) => !c.loop) : []
  const hotNow = has.filter((c) => c.kind !== 0)
  const hotWanted =
    out.status === 'too-many' ? [] : out.wanted.filter((c) => c.kind !== 0).map((c) => c.ms)
  const diff =
    onTrack && out.status !== 'too-many'
      ? hotDiff(
          hotWanted,
          hotNow.map((c) => c.ms),
        )
      : null
  const differ = diff ? diff.added.length + diff.gone.length : null
  const differs = diff !== null && differ !== null && differ > 0
  const view = `${track?.cues.contentId}\n${flow.id}`
  const [seen, setSeen] = useState(view)
  if (seen !== view) {
    setSeen(view)
    setNow(false)
    setPinned(false)
  }
  const mode: Mode = differs && now ? 'now' : 'flow'
  const goes = (c: { kind: number; ms: number }): boolean =>
    c.kind !== 0 && diff !== null && !hotWanted.some((ms) => samePosition(ms, c.ms))
  const shown =
    mode === 'now'
      ? has.filter((c) => !goes(c)).map((c) => ({ ...c, key: c.id, pending: false }))
      : cues
  const added = diff ? tr('settings.cueFlows.diffNew', { count: diff.added.length }) : ''
  const gone = diff ? tr('settings.cueFlows.diffGone', { count: diff.gone.length }) : ''
  const changes = !diff
    ? ''
    : mode === 'now'
      ? diff.gone.length > 0
        ? tr('settings.cueFlows.diffGoneNow', { count: diff.gone.length })
        : ''
      : diff.added.length === 0
        ? gone
        : diff.gone.length === 0
          ? added
          : tr('settings.cueFlows.diffBoth', { added, gone })
  const notices: { status: Status; text: string }[] = [
    ...(out.status === 'too-many'
      ? [
          {
            status: 'too-many' as const,
            text: tr('settings.cueFlows.tooMany', { count: out.needed }),
          },
        ]
      : []),
    ...(out.status === 'plan' && out.trimmed.length > 0 && mode === 'flow'
      ? [
          {
            status: 'trimmed' as const,
            text: tr('editor.cues.trimmed', { count: out.trimmed.length }),
          },
        ]
      : []),
    ...(differs && changes !== '' ? [{ status: 'compare' as const, text: changes }] : []),
    ...(track && real !== null && !marked
      ? [
          {
            status: 'no-mark' as const,
            text: tr('settings.cueFlows.noMark', { label: track.label }),
          },
        ]
      : []),
    ...(onTrack
      ? []
      : [
          {
            status: 'hint' as const,
            text: tr('settings.cueFlows.previewHint', { bar: EXAMPLE_POINT_BAR }),
          },
        ]),
  ]
  const notice = notices.at(0)
  const others =
    notices.length > 1 ? notices.map((n) => n.text).join(tr('settings.cueFlows.whenEachLead')) : ''
  const choices =
    track &&
    marked &&
    programOf(track.cues.contentId) === program &&
    !tracks.some((c) => c.contentId === track.cues.contentId)
      ? [{ contentId: track.cues.contentId, label: track.label }, ...tracks]
      : tracks

  const shownLabel = onTrack ? track.label : null
  const shownCues = onTrack ? track.cues : null
  useEffect(() => {
    onShown?.(shownLabel !== null && shownCues ? { label: shownLabel, cues: shownCues } : null)
  }, [onShown, shownLabel, shownCues])

  function show(next: boolean): void {
    setOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (pickerRef.current?.contains(e.target as Node)) return
      setOpen(false)
      onOpenChange?.(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  function close(): void {
    show(false)
    triggerRef.current?.focus()
  }

  function choose(choice: Choice | null): void {
    setSource(choice ? 'track' : 'example')
    setNow(false)
    if (choice) onPick?.(choice)
    close()
  }

  return (
    <div data-testid="cue-flow-preview">
      <div ref={pickerRef} className="relative mb-2">
        <button
          ref={triggerRef}
          type="button"
          data-testid="cue-preview-track"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => show(!open)}
          className="press flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pr-1.5 pl-2 text-xs text-fg-dim outline-none focus:border-[var(--color-accent)]"
        >
          <span className="min-w-0 truncate text-left">
            {onTrack ? track.label : tr('settings.cueFlows.exampleTrack')}
          </span>
          <span className="flex size-1.5 shrink-0">
            {differ === 0 && (
              <span
                data-testid="cue-preview-same"
                role="img"
                aria-label={tr('settings.cueFlows.compareSame')}
                className="size-1.5 rounded-full bg-[var(--color-good)]"
              >
                <Tooltip label={tr('settings.cueFlows.compareSame')} />
              </span>
            )}
          </span>
          <span className="flex-1" />
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
        {open && (
          <TrackChoices
            choices={choices}
            programs={programs}
            program={program}
            onProgram={(next) => onProgram?.(next)}
            loading={loading}
            inUse={onTrack ? track.cues.contentId : null}
            onChoose={choose}
            onClose={close}
          />
        )}
      </div>
      <CueWave
        wave={onTrack ? track.cues.wave : EXAMPLE_WAVE}
        grid={onTrack ? track.cues.grid : EXAMPLE_GRID}
        durationMs={onTrack ? track.cues.durationMs : EXAMPLE_DURATION_MS}
        cues={shown}
        trimmed={out.status === 'plan' && mode === 'flow' ? out.trimmed : []}
        ghost={{ added: [], gone: [], rejected: mode === 'flow' ? leftOut : [] }}
        diff={
          differs
            ? {
                fresh:
                  mode === 'flow'
                    ? cues
                        .filter((c) => c.kind !== 0 && diff.added.includes(c.ms))
                        .map((c) => c.key)
                    : [],
                gone: hotNow.filter(goes).map((c) => ({ ...c, key: c.id })),
                freshLabel: tr('settings.cueFlows.diffNewHint'),
                goneLabel: (letter) => tr('settings.cueFlows.diffGoneHint', { letter }),
                focused: pinned || hovered || focused,
              }
            : undefined
        }
        droppedLabel={(ms) =>
          leftOut
            .filter((c) => c.ms === ms)
            .map(
              (c) =>
                `${tr(`settings.cueFlows.leftOut.${flow.rules[c.rule].direction}`, {
                  rule: c.rule + 1,
                  count: c.bars,
                })}${tr('settings.cueFlows.whenEachLead')}${tr(`settings.cueFlows.leftOut.reason.${c.reason}`)}`,
            )
            .join('\n')
        }
        readOnly
      />
      <div data-testid="cue-preview-status" className="mt-1 flex h-10 items-center gap-2">
        {notice &&
          (differs ? (
            <button
              type="button"
              data-testid="cue-preview-compare"
              data-status={notice.status}
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className={`press -mx-1 min-w-0 truncate rounded px-1 text-left underline-offset-2 aria-pressed:underline ${NOTICE_TEXT[notice.status]}`}
            >
              {notice.text}
              {others !== '' && <Tooltip label={others} />}
            </button>
          ) : (
            <p
              data-testid={`cue-preview-${notice.status}`}
              data-status={notice.status}
              className={`min-w-0 truncate ${NOTICE_TEXT[notice.status]}`}
            >
              {notice.text}
              {others !== '' && <Tooltip label={others} />}
            </p>
          ))}
        <span className="flex-1" />
        {differs && (
          <SegmentedControl
            options={MODES}
            value={mode}
            onChange={(next) => {
              setNow(next === 'now')
              setPinned(false)
              setHovered(false)
              setFocused(false)
            }}
            testidPrefix="cue-preview-mode"
            compact
            className="shrink-0"
            label={tr('settings.cueFlows.preview')}
            labelFor={(id) => tr(`settings.cueFlows.previewMode.${id}`)}
          />
        )}
      </div>
    </div>
  )
}

export function CueFlowTrackPreview({
  flow,
  track,
  programs,
  inWindow,
  onShown,
}: {
  flow: CueFlow
  track?: Choice
  programs: readonly DjProgram[]
  inWindow?: DjProgram
  onShown?: (shown: { label: string; cues: TrackCues } | null) => void
}): React.JSX.Element {
  const [picked, setPicked] = useState(track)
  const [open, setOpen] = useState(false)
  const { data } = useTrackCues(picked?.contentId)
  const [chosen, setChosen] = useState<DjProgram>()
  const program =
    [chosen, track && programOf(track.contentId), inWindow].find(
      (p) => p !== undefined && programs.includes(p),
    ) ?? programs.at(0)
  const collection = useQuery({
    queryKey: ['source-playlist', program, ALL_TRACKS_ID],
    queryFn: () => readPlaylist(program as DjProgram, ALL_TRACKS_ID),
    enabled: program !== undefined && open,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const tracks = useMemo(() => {
    const marked = collectionChoices(collection.data ?? [])
    return track && marked.some((c) => c.contentId === track.contentId)
      ? [track, ...marked.filter((c) => c.contentId !== track.contentId)]
      : marked
  }, [collection.data, track])
  return (
    <CueFlowPreview
      flow={flow}
      track={picked && data ? { label: picked.label, cues: data } : undefined}
      tracks={tracks}
      programs={programs}
      program={program}
      onProgram={setChosen}
      loading={collection.isLoading}
      onPick={setPicked}
      onOpenChange={setOpen}
      onShown={onShown}
    />
  )
}
