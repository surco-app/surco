import { useQueryClient } from '@tanstack/react-query'
import { Keyboard } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, MY_FLOW_ID } from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import { BEATS_PER_BAR, MAX_HOT_CUES, nearestBeat } from '../../../shared/cueRules'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { type CueAudition, useCueAudition } from '../hooks/useCueAudition'
import { useMaximizedSection } from '../hooks/useEditorSections'
import { useCueWaveDetail, useQueuedCues, useTrackCues } from '../hooks/useTrackCues'
import type { DetailSource } from '../lib/cueDetail'
import {
  type CueDraft,
  type DraftAction,
  type DraftCue,
  draftDrops,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { flowName } from '../lib/cueFlowName'
import { type CueKey, cueKeyAction } from '../lib/cueKeys'
import {
  adjacentCall,
  callAt,
  cueClock,
  DEFAULT_ZOOM_BARS,
  jumpBeats,
  zoomStep,
} from '../lib/cuePlayhead'
import { forgetDraft, keepDraft, keepPlayhead, keptDraft, keptPlayhead } from '../lib/cueSession'
import { isTypingTarget } from '../lib/keymap'
import { isMacOS } from '../lib/platform'
import { cueLetter } from '../lib/rowCues'
import { useAppSettings } from '../lib/settingsContext'
import { formatShortcut } from '../lib/shortcuts'
import { claimKeys } from '../lib/spaceClaim'
import { CueDeck } from './CueDeck'
import { CuePalette } from './CuePalette'
import { CueWave } from './CueWave'
import { CueWaveDetail } from './CueWaveDetail'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { Select } from './Select'

interface CueTarget {
  contentId: string
  path: string
  label: string
}

export interface CueTrackInfo {
  title: string
  artist: string
  bpm: string
  key: string
  cover?: string
}

const ignore = () => {}

const HIDDEN_SECTION_KEYS: Parameters<typeof claimKeys>[0] = {
  'trim-start-back': ignore,
  'trim-start-forward': ignore,
  'trim-start-audition': ignore,
  'trim-start-clear': ignore,
  'trim-end-back': ignore,
  'trim-end-forward': ignore,
  'trim-end-audition': ignore,
  'trim-end-clear': ignore,
  'trim-apply': ignore,
  'trim-start-zoom-in': ignore,
  'trim-start-zoom-out': ignore,
  'trim-end-zoom-in': ignore,
  'trim-end-zoom-out': ignore,
  'section-next': ignore,
  'section-prev': ignore,
  next: ignore,
  prev: ignore,
  'list-top': ignore,
  'list-bottom': ignore,
  'list-page-up': ignore,
  'list-page-down': ignore,
  remove: ignore,
  'process-current': ignore,
  'clear-meta': ignore,
  'process-all': ignore,
  'derive-tags': ignore,
}

const MENU_ITEM =
  'block w-full whitespace-nowrap px-3 py-1 text-left hover:bg-[var(--color-hover)] disabled:opacity-40'

function CueKeys({
  jumpBars,
  onClose,
}: {
  jumpBars: number
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose])
  const mac = isMacOS()
  const shift = formatShortcut(['shift'], mac)
  const keys: [string, string][] = [
    [tr('editor.cues.keys.space'), tr('editor.cues.keys.play')],
    ['← →', tr('editor.cues.keys.jump', { count: jumpBars })],
    [`${shift}← ${shift}→`, tr('editor.cues.keys.beat')],
    ['C', tr('editor.cues.keys.centre')],
    ['M', tr('editor.cues.keys.memory')],
    ['1…8', tr('editor.cues.keys.hot')],
    [formatShortcut(['backspace'], mac), tr('editor.cues.keys.remove')],
    [formatShortcut(['mod', 'z'], mac), tr('editor.cues.keys.undo')],
    ['+ −', tr('editor.cues.keys.zoom')],
  ]
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="cues-keys"
        aria-label={tr('editor.cues.keys.button')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          if (open) onClose()
          setOpen(!open)
        }}
        className="press flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:text-fg"
      >
        <Keyboard className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <ul
          data-testid="cues-legend"
          aria-label={tr('editor.cues.keys.label')}
          className="absolute top-full right-0 z-20 mt-1 grid w-max grid-cols-2 gap-x-5 gap-y-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3 text-xs text-fg-dim shadow-[var(--shadow-float)]"
        >
          {keys.map(([chord, what]) => (
            <li key={chord} className="flex items-center gap-1.5">
              <kbd className="rounded border border-b-2 border-[var(--color-line-strong)] px-1.5 font-mono text-[11px] text-fg">
                {chord}
              </kbd>
              {what}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Editing({
  read,
  queued,
  cue,
  draftKey,
  maximized,
  track,
  playheadMs,
  onPlayhead,
  audition,
  onJumpBars,
  onDiscard,
}: {
  read: TrackCues
  queued: QueuedCues | null
  cue: CueTarget
  draftKey: string
  maximized: boolean
  track?: CueTrackInfo
  playheadMs: number
  onPlayhead: (ms: number) => void
  audition: CueAudition
  onJumpBars?: (bars: CueJumpBars) => void
  onDiscard: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const ctx = useMemo(
    () => ({
      beats: read.grid.map((b) => b.ms),
      strong: read.strong,
      phrases: read.phrases,
      flows,
    }),
    [read, flows],
  )
  const inRekordbox = useMemo(
    () => read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color })),
    [read],
  )
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const baseline = fresh ? queued.wanted : inRekordbox
  const [state, dispatch] = useReducer(
    (s: CueDraft, a: DraftAction) => reduceDraft(s, a, ctx),
    undefined,
    () =>
      keptDraft(draftKey) ??
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
  useEffect(() => keepDraft(draftKey, state), [draftKey, state])
  const [menu, setMenu] = useState<{ ms: number; x: number; y: number } | null>(null)
  const [askedForDrop, setAskedForDrop] = useState(false)
  const noDrop = draftDrops(state.cues, state.locked).length === 0
  const [chosen, setChosen] = useState(state.flowId)
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const openedWith = useRef(active.id)
  useEffect(() => {
    if (openedWith.current === active.id) return
    openedWith.current = active.id
    setChosen(active.id)
    dispatch({ type: 'use-flow', flowId: active.id })
  }, [active.id])
  const menuRef = useRef<HTMLDivElement>(null)
  const wanted = wantedOfDraft(state.cues)
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  const pending = (c: DraftCue): boolean =>
    !inRekordbox.some(
      (r) => r.id === c.id && r.ms === c.ms && r.kind === c.kind && r.color === c.color,
    )
  const selected = state.cues.find((c) => c.key === state.selected)
  const refreshQueued = () => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
  useEffect(() => {
    if (menu === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (maximized) e.stopPropagation()
      setMenu(null)
    }
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menu, maximized])
  const fromMenu = (action: DraftAction) => {
    dispatch(action)
    setMenu(null)
  }
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM_BARS)
  const { data: words } = useCueWaveDetail(cue.contentId, maximized)
  const source: DetailSource | null = words
    ? { words }
    : read.wave
      ? { wave: read.wave, durationMs: read.durationMs }
      : null
  const seekTo = (ms: number) => onPlayhead(Math.min(Math.max(ms, 0), read.durationMs))
  const pad = (kind: number) => {
    const existing = state.cues.find((c) => c.kind === kind)
    if (!existing) {
      dispatch({ type: 'add-hot', ms: playheadMs, kind })
      return
    }
    dispatch({ type: 'select', key: existing.key })
    seekTo(existing.ms)
  }
  const memoryStep = (dir: 1 | -1) => {
    const to = adjacentCall(state.cues, playheadMs, dir)
    if (to !== null) seekTo(to)
  }
  const callHere =
    callAt(state.cues, playheadMs) ??
    callAt(state.cues, ctx.beats[nearestBeat(ctx.beats, playheadMs)])
  const memoryRemove = () => {
    if (callHere) dispatch({ type: 'remove', key: callHere.key })
  }
  const run = (key: CueKey) => {
    if (key.type === 'play') audition.toggle(playheadMs)
    else if (key.type === 'jump')
      seekTo(jumpBeats(ctx.beats, playheadMs, key.dir * settings.cueJumpBars * BEATS_PER_BAR))
    else if (key.type === 'beat') seekTo(jumpBeats(ctx.beats, playheadMs, key.dir))
    else if (key.type === 'centre') seekTo(ctx.beats[nearestBeat(ctx.beats, playheadMs)])
    else if (key.type === 'memory') dispatch({ type: 'add-call', ms: playheadMs })
    else if (key.type === 'hot') pad(key.kind)
    else if (key.type === 'remove' && selected) dispatch({ type: 'remove', key: selected.key })
    else if (key.type === 'undo') dispatch({ type: 'undo' })
    else if (key.type === 'zoom') setZoom((z) => zoomStep(z, key.dir))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (maximized) {
      const target = e.target as HTMLElement
      if (isTypingTarget(target) || target.closest('[aria-haspopup="listbox"]')) return
      const key = cueKeyAction(e)
      if (!key) return
      e.preventDefault()
      run(key)
      return
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch({ type: 'remove', key: selected.key })
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: 'undo' })
    }
  }
  const editorRef = useRef<HTMLFieldSetElement>(null)
  const focusEditor = useCallback(() => editorRef.current?.focus(), [])
  const [colourFor, setColourFor] = useState<string | null>(null)
  const colourOpen = colourFor !== null && colourFor === state.selected
  const colourRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!colourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setColourFor(null)
      focusEditor()
    }
    const onDown = (e: MouseEvent) => {
      if (!colourRef.current?.contains(e.target as Node)) setColourFor(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [colourOpen, focusEditor])
  useEffect(() => {
    if (maximized) editorRef.current?.focus()
  }, [maximized])
  const waveCues = state.cues.map((c) => ({
    ...c,
    pending: pending(c),
    locked: state.locked.includes(c.key),
  }))
  return (
    <fieldset
      ref={editorRef}
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={maximized ? -1 : undefined}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none ${maximized ? 'flex flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && (
        <div
          data-testid="cues-header"
          className="flex items-center gap-4 border-b border-[var(--color-line)] pb-3"
        >
          {track?.cover ? (
            <img src={track.cover} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
          ) : (
            <div
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-md bg-[var(--color-panel-2)]"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-fg">
              {track?.title || cue.label}
            </div>
            <div className="truncate text-xs text-fg-dim">{track?.artist}</div>
          </div>
          <div className="ml-auto flex shrink-0 gap-4 font-mono text-[13px] tabular-nums text-fg-dim">
            <span data-testid="cues-position" className="text-fg">
              {cueClock(playheadMs)}
            </span>
            <span data-testid="cues-remaining">{`-${cueClock(read.durationMs - playheadMs)}`}</span>
            {track?.bpm && (
              <span data-testid="cues-bpm">{tr('editor.cues.bpm', { bpm: track.bpm })}</span>
            )}
            {track?.key && <span data-testid="cues-key">{track.key}</span>}
          </div>
          <CueKeys jumpBars={settings.cueJumpBars} onClose={focusEditor} />
        </div>
      )}
      <div data-testid="cues-flow-row" className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-fg-dim">{tr('editor.cues.flow')}</span>
        <Select
          testid="cues-flow"
          label={tr('editor.cues.flow')}
          value={shownFlow}
          onChange={setChosen}
          options={flows.map((f) => ({ value: f.id, label: flowName(f, tr) }))}
        />
        <button
          type="button"
          data-testid="cues-apply-flow"
          onClick={() => {
            if (noDrop) setAskedForDrop(true)
            else dispatch({ type: 'apply-flow', flowId: shownFlow })
          }}
          className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {tr('editor.cues.applyFlow')}
        </button>
        {askedForDrop && noDrop && (
          <span data-testid="cues-needs-drop" role="status" className="text-xs text-warn">
            {tr('editor.cues.needsDrop')}
          </span>
        )}
      </div>
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        cues={waveCues}
        selected={state.selected}
        trimmed={state.trimmed}
        onMarkDrop={(ms) => dispatch({ type: 'mark-drop', ms })}
        onUnmarkDrop={(key) => dispatch({ type: 'unmark-drop', key })}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onMove={(key, ms) => dispatch({ type: 'move', key, ms })}
        onMenu={setMenu}
        playheadMs={maximized ? playheadMs : undefined}
        onSeek={maximized ? seekTo : undefined}
      />
      {maximized && (
        <CueWaveDetail
          source={source}
          grid={read.grid}
          cues={waveCues}
          selected={state.selected}
          playheadMs={playheadMs}
          bars={zoom}
          onScrub={seekTo}
          onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
        />
      )}
      {menu !== null && (
        <div
          ref={menuRef}
          data-testid="cues-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="absolute z-20 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs shadow-[var(--shadow-float)]"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-hot"
            disabled={state.cues.filter((c) => c.kind !== 0).length >= MAX_HOT_CUES}
            onClick={() => fromMenu({ type: 'add-hot', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddHot')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-add-call"
            onClick={() => fromMenu({ type: 'add-call', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuAddCall')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="cues-menu-mark-drop"
            onClick={() => fromMenu({ type: 'mark-drop', ms: menu.ms })}
            className={MENU_ITEM}
          >
            {tr('editor.cues.menuMarkDrop')}
          </button>
        </div>
      )}
      {selected && (
        <div
          data-testid="cues-selection"
          className="mt-2 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="font-medium">
            {selected.kind === 0
              ? tr('editor.cues.selectedCall')
              : tr('editor.cues.selectedHot', { letter: cueLetter(selected.kind) })}
          </span>
          {state.locked.includes(selected.key) && (
            <span data-testid="cues-loop" className="text-fg-dim">
              {tr('editor.cues.loop')}
            </span>
          )}
          {selected.kind !== 0 && !state.locked.includes(selected.key) && (
            <>
              <div ref={colourRef} className="relative">
                <button
                  type="button"
                  data-testid="cues-colour"
                  aria-label={tr('editor.cues.colourPicker')}
                  aria-haspopup="true"
                  aria-expanded={colourOpen}
                  onClick={() => setColourFor(colourOpen ? null : selected.key)}
                  style={{ backgroundColor: hotCueColor(selected.color) }}
                  className="press block h-6 w-6 rounded-[3px] border border-[var(--color-line-strong)]"
                />
                {colourOpen && (
                  <div
                    data-testid="cues-colour-popover"
                    className="absolute z-20 mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-[var(--shadow-float)]"
                  >
                    <CuePalette
                      value={selected.color}
                      onPick={(color) => {
                        dispatch({ type: 'recolour', key: selected.key, color })
                        setColourFor(null)
                        focusEditor()
                      }}
                      label={(index) => tr('editor.cues.colour', { index })}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {!state.locked.includes(selected.key) && (
            <button
              type="button"
              data-testid="cues-delete"
              onClick={() => dispatch({ type: 'remove', key: selected.key })}
              className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1 hover:bg-[var(--color-hover)]"
            >
              {tr('editor.cues.delete')}
            </button>
          )}
        </div>
      )}
      {queued !== null && !fresh && (
        <p data-testid="cues-queued-stale" className="mt-2 text-xs text-warn">
          {tr('editor.cues.queuedStale')}
        </p>
      )}
      {state.notice === 'manual' && (
        <p data-testid="cues-manual" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.manual')}
        </p>
      )}
      {state.notice === 'too-many' && (
        <p data-testid="cues-too-many" className="mt-2 text-xs text-warn">
          {tr('editor.cues.tooMany')}
        </p>
      )}
      {state.trimmed.length > 0 && (
        <p data-testid="cues-trimmed" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.trimmed', { count: state.trimmed.length })}
        </p>
      )}
      {maximized && (
        <CueDeck
          cues={state.cues}
          selected={state.selected}
          locked={state.locked}
          jumpBars={settings.cueJumpBars}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          canRemoveMemory={callHere !== undefined}
          onJumpBars={(bars) => onJumpBars?.(bars)}
          onDone={focusEditor}
        />
      )}
      <div data-testid="cues-actions" className="mt-3 flex flex-wrap items-center gap-3">
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="cues-undo"
            disabled={unchanged && queued === null}
            onClick={onDiscard}
            className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.discard')}
          </button>
          <button
            type="button"
            data-testid="cues-save"
            disabled={unchanged}
            onClick={() => {
              void window.api
                .saveRekordboxCues({
                  contentId: cue.contentId,
                  path: cue.path,
                  label: cue.label,
                  wanted,
                  fingerprint: read.fingerprint,
                })
                .then(refreshQueued)
            }}
            className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.save')}
          </button>
        </div>
      </div>
    </fieldset>
  )
}

export function CuesSection({
  cue,
  open,
  onToggle,
  track,
  onJumpBars,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
  track?: CueTrackInfo
  onJumpBars?: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  const { maximized: whole } = useMaximizedSection()
  const maximized = open && whole === 'cues'
  const [round, setRound] = useState(0)
  const draftKey = `${cue.contentId}|${read?.fingerprint ?? ''}|${JSON.stringify(queued)}`
  const [head, setHead] = useState(() => ({
    contentId: cue.contentId,
    ms: keptPlayhead(cue.contentId),
  }))
  const playheadMs = head.contentId === cue.contentId ? head.ms : 0
  const follow = (ms: number) => {
    setHead({ contentId: cue.contentId, ms })
    keepPlayhead(cue.contentId, ms)
  }
  const audition = useCueAudition(cue.path, maximized, follow)
  const moveHead = (ms: number) => {
    follow(ms)
    audition.seek(ms)
  }
  const toggle = useRef(() => {})
  toggle.current = () => audition.toggle(playheadMs)
  useEffect(() => {
    if (!maximized) return
    return claimKeys({ ...HIDDEN_SECTION_KEYS, play: () => toggle.current() }, { over: true })
  }, [maximized])
  return (
    <div data-testid="cues-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="cues"
        maximizable
        title={tr('editor.cues.title')}
        open={open}
        onToggle={onToggle}
        help={tr('editor.cues.help')}
      />
      <SectionBody open={open}>
        <div className="mt-3">
          {isError || read === null ? (
            <p data-testid="cues-unreadable" className="text-xs text-fg-dim">
              {tr('editor.cues.unreadable')}
            </p>
          ) : read === undefined || queued === undefined ? null : !read.analysed ||
            read.grid.length === 0 ? (
            <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
              {tr('editor.cues.unanalysed')}
            </p>
          ) : (
            <Editing
              key={`${draftKey}|${round}`}
              read={read}
              queued={queued}
              cue={cue}
              draftKey={draftKey}
              maximized={maximized}
              track={track}
              playheadMs={playheadMs}
              onPlayhead={moveHead}
              audition={audition}
              onJumpBars={onJumpBars}
              onDiscard={() => {
                forgetDraft()
                setRound((n) => n + 1)
                if (queued !== null)
                  void window.api
                    .undoRekordboxCues(cue.contentId)
                    .then(() =>
                      queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }),
                    )
              }}
            />
          )}
        </div>
      </SectionBody>
    </div>
  )
}
