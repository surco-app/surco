import { Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow } from '../../../shared/cueFlows'
import { rejectedCues } from '../../../shared/cueRules'
import { foldAccents } from '../../../shared/foldAccents'
import type { TrackCues } from '../../../shared/types'
import { useTrackCues } from '../hooks/useTrackCues'
import {
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
import { clipBox, MENU_GAP } from './CueRuleRow'
import { CueWave } from './CueWave'
import { SegmentedControl } from './SegmentedControl'
import { showOption } from './Select'
import { Tooltip } from './Tooltip'

type Source = 'track' | 'example'
type Mode = 'flow' | 'now'

const MODES: readonly Mode[] = ['flow', 'now']

interface Choice {
  contentId: string
  label: string
}

const NO_CHOICES: Choice[] = []
const MAX_CHOICES = 100
const OPTION =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-[var(--color-hover)]'

const folded = (text: string): string => foldAccents(text).toLowerCase()

function TrackChoices({
  choices,
  inUse,
  onChoose,
  onClose,
}: {
  choices: Choice[]
  inUse: string | null
  onChoose: (choice: Choice | null) => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wanted = folded(query.trim())
  const found = choices.filter((c) => folded(c.label).includes(wanted)).slice(0, MAX_CHOICES)

  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const box = menu.getBoundingClientRect()
    const clip = clipBox(menu)
    const below = box.top + (menu.offsetHeight || box.height) + MENU_GAP - clip.bottom
    if (below > 0 && clip.scroller) clip.scroller.scrollTop += Math.ceil(below)
  }, [])

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

  return (
    <div
      ref={menuRef}
      data-testid="cue-preview-track-menu"
      className="animate-pop-flat absolute inset-x-0 top-full z-20 mt-1 origin-top rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-[var(--shadow-float)]"
    >
      <input
        ref={searchRef}
        data-testid="cue-preview-track-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={tr('settings.cueFlows.searchList')}
        aria-label={tr('settings.cueFlows.searchList')}
        className="mb-1 h-7 w-full min-w-0 border-b border-[var(--color-line)] bg-transparent px-2 text-xs text-fg outline-none focus-visible:shadow-none placeholder:text-fg-faint"
      />
      <div
        ref={listRef}
        role="listbox"
        data-testid="cue-preview-track-listbox"
        aria-label={tr('settings.cueFlows.preview')}
        onKeyDown={onKeyDown}
        className="relative max-h-56 overflow-y-auto"
      >
        <button
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
        {choices.length > 0 && (
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
            <Check
              aria-hidden="true"
              className={`size-3 shrink-0 ${c.contentId === inUse ? '' : 'invisible'}`}
            />
          </button>
        ))}
      </div>
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
  onPick,
}: {
  flow: CueFlow
  track?: { label: string; cues: TrackCues }
  tracks?: Choice[]
  onPick?: (choice: Choice) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [source, setSource] = useState<Source>('track')
  const [open, setOpen] = useState(false)
  const [nowOf, setNowOf] = useState<string | null>(null)
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
    setPinned(false)
  }
  const mode: Mode = differs && nowOf === view ? 'now' : 'flow'
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
  const choices =
    track && marked && !tracks.some((c) => c.contentId === track.cues.contentId)
      ? [{ contentId: track.cues.contentId, label: track.label }, ...tracks]
      : tracks

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!pickerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function choose(choice: Choice | null): void {
    setSource(choice ? 'track' : 'example')
    setNowOf(null)
    if (choice) onPick?.(choice)
    close()
  }

  return (
    <div data-testid="cue-flow-preview" className="pl-1">
      <div ref={pickerRef} className="relative mb-2">
        <button
          ref={triggerRef}
          type="button"
          data-testid="cue-preview-track"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
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
                goneLabel: tr('settings.cueFlows.diffGoneHint'),
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
      {!onTrack && (
        <p className="mt-1 text-label text-fg-dim">
          {tr('settings.cueFlows.previewHint', { bar: EXAMPLE_POINT_BAR })}
        </p>
      )}
      {track && real !== null && !marked && (
        <p data-testid="cue-preview-no-mark" className="mt-1 text-label text-fg-dim">
          {tr('settings.cueFlows.noMark', { label: track.label })}
        </p>
      )}
      {differs && (
        <div data-testid="cue-preview-diff" className="mt-1 flex items-center gap-2">
          {changes !== '' && (
            <button
              type="button"
              data-testid="cue-preview-compare"
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="press min-w-0 truncate rounded-sm text-left text-xs text-warn"
            >
              {changes}
            </button>
          )}
          <span className="flex-1" />
          <SegmentedControl
            options={MODES}
            value={mode}
            onChange={(next) => {
              setNowOf(next === 'now' ? view : null)
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
        </div>
      )}
      {out.status === 'too-many' && (
        <p data-testid="cue-preview-too-many" className="mt-1 text-xs text-warn">
          {tr('settings.cueFlows.tooMany', { count: out.needed })}
        </p>
      )}
      {out.status === 'plan' && out.trimmed.length > 0 && (
        <p data-testid="cue-preview-trimmed" className="mt-1 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: out.trimmed.length })}
        </p>
      )}
    </div>
  )
}

export function CueFlowTrackPreview({
  flow,
  track,
  tracks,
}: {
  flow: CueFlow
  track?: Choice
  tracks?: Choice[]
}): React.JSX.Element {
  const [picked, setPicked] = useState(track)
  const { data } = useTrackCues(picked?.contentId)
  return (
    <CueFlowPreview
      flow={flow}
      track={picked && data ? { label: picked.label, cues: data } : undefined}
      tracks={tracks}
      onPick={setPicked}
    />
  )
}
