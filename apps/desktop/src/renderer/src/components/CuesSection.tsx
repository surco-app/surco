import { useQueryClient } from '@tanstack/react-query'
import { Keyboard, Minimize2 } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  activeCueFlow,
  followsPoint,
  MANUAL_CUE_FLOW,
  MY_FLOW,
  MY_FLOW_ID,
} from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import {
  BEATS_PER_BAR,
  MAX_HOT_CUES,
  nearestBeat,
  SAME_POSITION_MS,
} from '../../../shared/cueRules'
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
  type DraftGhost,
  ghostOf,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { flowName } from '../lib/cueFlowName'
import { type CueKey, cueKeyAction } from '../lib/cueKeys'
import {
  adjacentCall,
  callAt,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  jumpBeats,
  zoomStep,
} from '../lib/cuePlayhead'
import { forgetDraft, keepDraft, keepPlayhead, keptDraft, keptPlayhead } from '../lib/cueSession'
import { quantizePoints } from '../lib/cueWave'
import { formatTime } from '../lib/duration'
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
        className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
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
  onQuantize,
  onFlow,
  onDiscard,
  onRestore,
  onMaximize,
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
  onQuantize?: (unit: CueQuantize) => void
  onFlow?: (id: string) => void
  onDiscard: () => void
  onRestore: () => void
  onMaximize: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const ctx = useMemo(
    () => ({
      beats: read.grid.map((b) => b.ms),
      snapTo: quantizePoints(read.grid, settings.cueQuantize),
      strong: read.strong,
      phrases: read.phrases,
      flows,
    }),
    [read, flows, settings.cueQuantize],
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
  const [markMenu, setMarkMenu] = useState<{
    key: string
    x: number
    y: number
    palette: boolean
  } | null>(null)
  const settled = settings.activeCueFlow === MANUAL_CUE_FLOW ? MANUAL_CUE_FLOW : active.id
  const [chosen, setChosen] = useState(settled === MANUAL_CUE_FLOW ? MANUAL_CUE_FLOW : state.flowId)
  const manual = chosen === MANUAL_CUE_FLOW
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : MY_FLOW_ID
  const placing = !manual && followsPoint(flows.find((f) => f.id === shownFlow) ?? MY_FLOW)
  const pickMode = (id: string) => {
    setChosen(id)
    if (id !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: id })
    onFlow?.(id)
  }
  const place = (ms: number) => dispatch({ type: 'mark-drop', ms })
  const switchGhost = useMemo<DraftGhost | null>(
    () => (manual ? null : ghostOf(state, { type: 'apply-flow', flowId: shownFlow }, ctx)),
    [manual, state, shownFlow, ctx],
  )
  const canApply =
    switchGhost !== null && (switchGhost.added.length > 0 || switchGhost.gone.length > 0)
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  const hoverGhost = useMemo<DraftGhost | null>(
    () =>
      placing && hoverMs !== null ? ghostOf(state, { type: 'mark-drop', ms: hoverMs }, ctx) : null,
    [placing, hoverMs, state, ctx],
  )
  const ghost = hoverGhost ?? (canApply && switchGhost !== null ? switchGhost : undefined)
  const openedWith = useRef(settled)
  useEffect(() => {
    if (openedWith.current === settled) return
    openedWith.current = settled
    setChosen(settled)
    if (settled !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: settled })
  }, [settled])
  const menuRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLFieldSetElement>(null)
  const focusEditor = useCallback(() => editorRef.current?.focus(), [])
  const wanted = wantedOfDraft(state.cues)
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  const pending = (c: DraftCue): boolean =>
    !inRekordbox.some(
      (r) => r.id === c.id && r.ms === c.ms && r.kind === c.kind && r.color === c.color,
    )
  const selected = state.cues.find((c) => c.key === state.selected)
  const refreshQueued = () => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
  const menuOpen = menu !== null || markMenu !== null
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (maximized || markMenu !== null) e.stopPropagation()
      setMenu(null)
      if (markMenu !== null) {
        setMarkMenu(null)
        focusEditor()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenu(null)
      setMarkMenu(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen, markMenu, maximized, focusEditor])
  const fromMenu = (action: DraftAction) => {
    dispatch(action)
    setMenu(null)
  }
  const openMarkMenu = ({
    key,
    clientX,
    clientY,
  }: {
    key: string
    clientX: number
    clientY: number
  }) => {
    if (state.locked.includes(key)) return
    const rect = editorRef.current?.getBoundingClientRect()
    setMenu(null)
    dispatch({ type: 'select', key })
    setMarkMenu({
      key,
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
      palette: false,
    })
  }
  const fromMarkMenu = (action: DraftAction) => {
    dispatch(action)
    setMarkMenu(null)
    focusEditor()
  }
  const markTarget = markMenu !== null ? state.cues.find((c) => c.key === markMenu.key) : undefined
  const callUnder =
    markTarget && markTarget.kind !== 0
      ? state.cues.find(
          (c) =>
            c.kind === 0 &&
            Math.abs(c.ms - markTarget.ms) <= SAME_POSITION_MS &&
            !state.locked.includes(c.key),
        )
      : undefined
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM_BARS)
  const { data: words } = useCueWaveDetail(cue.contentId, maximized)
  const source: DetailSource | null = words
    ? { words }
    : read.wave
      ? { wave: read.wave, durationMs: read.durationMs }
      : null
  const seekTo = (ms: number) => onPlayhead(Math.min(Math.max(ms, 0), read.durationMs))
  const openAt = (ms: number) => {
    seekTo(ms)
    onMaximize()
  }
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
    if (to === null) return
    seekTo(to)
    const call = callAt(state.cues, to)
    if (call) dispatch({ type: 'select', key: call.key })
  }
  const removableCall =
    selected && selected.kind === 0
      ? selected
      : (callAt(state.cues, playheadMs) ??
        callAt(state.cues, ctx.snapTo[nearestBeat(ctx.snapTo, playheadMs)]))
  const memoryRemove = () => {
    if (!removableCall || state.locked.includes(removableCall.key)) return
    dispatch({ type: 'remove', key: removableCall.key })
    focusEditor()
  }
  const run = (key: CueKey) => {
    if (key.type === 'play') audition.toggle(playheadMs)
    else if (key.type === 'jump')
      seekTo(jumpBeats(ctx.beats, playheadMs, key.dir * settings.cueJumpBars * BEATS_PER_BAR))
    else if (key.type === 'beat') seekTo(jumpBeats(ctx.beats, playheadMs, key.dir))
    else if (key.type === 'centre') seekTo(ctx.snapTo[nearestBeat(ctx.snapTo, playheadMs)])
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
  const save = () => {
    void window.api
      .saveRekordboxCues({
        contentId: cue.contentId,
        path: cue.path,
        label: cue.label,
        wanted,
        fingerprint: read.fingerprint,
      })
      .then(refreshQueued)
  }
  const actions = (
    <div data-testid="cues-actions" className="flex flex-wrap items-center gap-2">
      <Select
        testid="cues-flow"
        portal
        lead={tr('editor.cues.flow')}
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickMode}
        onClosed={maximized ? focusEditor : undefined}
        options={[
          ...flows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
          { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
        ]}
      />
      {canApply && (
        <button
          type="button"
          data-testid="cues-apply-track"
          onClick={() => {
            dispatch({ type: 'apply-flow', flowId: shownFlow })
            if (maximized) focusEditor()
          }}
          className="press h-8 whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          {tr('editor.cues.applyTrack')}
        </button>
      )}
      {placing && (
        <span data-testid="cues-place-hint" role="status" className="text-xs text-fg-dim">
          {tr('editor.cues.placeHint')}
        </span>
      )}
      <span className="flex-1" />
      {(!unchanged || queued !== null) && (
        <button
          type="button"
          data-testid="cues-undo"
          onClick={onDiscard}
          className="press whitespace-nowrap px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
        >
          {tr('editor.cues.discard')}
        </button>
      )}
      <button
        type="button"
        data-testid="cues-save"
        disabled={unchanged}
        aria-label={maximized ? undefined : tr('editor.cues.save')}
        onClick={save}
        className="press h-8 whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 text-xs font-semibold text-fg hover:bg-[var(--color-hover)] disabled:opacity-40"
      >
        {maximized ? tr('editor.cues.save') : tr('editor.cues.saveShort')}
      </button>
    </div>
  )
  const header = (
    <div data-testid="cues-header" className="flex shrink-0 items-center gap-3.5">
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
      <div
        data-testid="cues-meta"
        className="ml-2 flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-fg-faint"
      >
        <span data-testid="cues-duration">{formatTime(read.durationMs / 1000)}</span>
        {track?.bpm && (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="cues-bpm">{tr('editor.cues.bpm', { bpm: track.bpm })}</span>
          </>
        )}
        {track?.key && (
          <>
            <span aria-hidden="true">·</span>
            <span data-testid="cues-key">{track.key}</span>
          </>
        )}
      </div>
      <span className="flex-1" />
      {actions}
      <CueKeys jumpBars={settings.cueJumpBars} onClose={focusEditor} />
      <button
        type="button"
        data-testid="section-maximize"
        aria-label={tr('editor.sectionRestore')}
        aria-pressed="true"
        onClick={onRestore}
        className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
      >
        <Minimize2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
  return (
    <fieldset
      ref={editorRef}
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={maximized ? -1 : undefined}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none focus-visible:shadow-none ${maximized ? 'my-auto flex flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && header}
      <CueWave
        wave={read.wave}
        grid={read.grid}
        quantize={settings.cueQuantize}
        durationMs={read.durationMs}
        cues={waveCues}
        selected={state.selected}
        trimmed={state.trimmed}
        onPlace={placing ? place : undefined}
        onHover={placing ? setHoverMs : undefined}
        ghost={ghost}
        onSelect={(key) => dispatch({ type: 'select', key })}
        onMove={(key, ms) => dispatch({ type: 'move', key, ms })}
        onMenu={maximized ? setMenu : undefined}
        onMarkMenu={openMarkMenu}
        playheadMs={maximized ? playheadMs : undefined}
        onSeek={maximized ? seekTo : undefined}
        onOpen={maximized || placing ? undefined : openAt}
        view={maximized ? detailWindow(ctx.beats, playheadMs, zoom) : undefined}
      />
      {!maximized && <div className="mt-3">{actions}</div>}
      {maximized && (
        <CueWaveDetail
          source={source}
          grid={read.grid}
          cues={waveCues}
          selected={state.selected}
          playheadMs={playheadMs}
          bars={zoom}
          quantize={settings.cueQuantize}
          onScrub={seekTo}
          onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
          onPlace={placing ? place : undefined}
          onHover={placing ? setHoverMs : undefined}
          ghost={ghost}
          onMarkMenu={openMarkMenu}
          onDeleteMark={(key) => dispatch({ type: 'remove', key })}
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
          {placing && (
            <button
              type="button"
              role="menuitem"
              data-testid="cues-menu-mark-drop"
              onClick={() => fromMenu({ type: 'mark-drop', ms: menu.ms })}
              className={MENU_ITEM}
            >
              {tr('editor.cues.menuMarkDrop')}
            </button>
          )}
        </div>
      )}
      {markMenu !== null && markTarget && (
        <div
          ref={menuRef}
          data-testid="cues-menu"
          role="menu"
          style={{ left: markMenu.x, top: markMenu.y }}
          className="absolute z-20 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 text-xs shadow-[var(--shadow-float)]"
        >
          {markMenu.palette ? (
            <div className="p-2">
              <CuePalette
                value={markTarget.color}
                onPick={(color) => fromMarkMenu({ type: 'recolour', key: markTarget.key, color })}
                label={(index) => tr('editor.cues.colour', { index })}
              />
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="cues-menu-delete"
                onClick={() => fromMarkMenu({ type: 'remove', key: markTarget.key })}
                className={MENU_ITEM}
              >
                {tr('editor.cues.delete')}
              </button>
              {markTarget.kind !== 0 && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="cues-menu-colour"
                  onClick={() => setMarkMenu({ ...markMenu, palette: true })}
                  className={MENU_ITEM}
                >
                  {tr('editor.cues.menuColour')}
                </button>
              )}
              {callUnder && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="cues-menu-delete-call"
                  onClick={() => fromMarkMenu({ type: 'remove', key: callUnder.key })}
                  className={MENU_ITEM}
                >
                  {tr('editor.cues.menuDeleteCall')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {selected && !maximized && (
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
          quantize={settings.cueQuantize}
          playing={audition.playing}
          onPlay={() => audition.toggle(playheadMs)}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onDelete={(key) => dispatch({ type: 'remove', key })}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          canRemoveMemory={removableCall !== undefined && !state.locked.includes(removableCall.key)}
          onJumpBars={(bars) => onJumpBars?.(bars)}
          onQuantize={(unit) => onQuantize?.(unit)}
          onDone={focusEditor}
        />
      )}
    </fieldset>
  )
}

export function CuesSection({
  cue,
  open,
  onToggle,
  track,
  onJumpBars,
  onQuantize,
  onFlow,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
  track?: CueTrackInfo
  onJumpBars?: (bars: CueJumpBars) => void
  onQuantize?: (unit: CueQuantize) => void
  onFlow?: (id: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  const { maximized: whole, setMaximized } = useMaximizedSection()
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
  const editable =
    !isError &&
    read !== undefined &&
    read !== null &&
    queued !== undefined &&
    read.analysed &&
    read.grid.length > 0
  const full = maximized && editable
  const body =
    isError || read === null ? (
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
        onQuantize={onQuantize}
        onFlow={onFlow}
        onRestore={() => setMaximized(null)}
        onMaximize={() => setMaximized('cues')}
        onDiscard={() => {
          forgetDraft()
          setRound((n) => n + 1)
          if (queued !== null)
            void window.api
              .undoRekordboxCues(cue.contentId)
              .then(() => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] }))
        }}
      />
    )
  return (
    <div
      data-testid="cues-section"
      className={full ? 'flex h-full flex-col' : 'mt-6 border-t border-[var(--color-line)] pt-6'}
    >
      {!full && (
        <SectionHeader
          sectionId="cues"
          maximizable
          title={tr('editor.cues.title')}
          open={open}
          onToggle={onToggle}
          help={tr('editor.cues.help')}
        />
      )}
      {full && isMacOS() && (
        <div
          data-testid="cues-titlebar-inset"
          aria-hidden="true"
          className="h-10 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      {full ? (
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      ) : (
        <SectionBody open={open}>
          <div className="mt-3">{body}</div>
        </SectionBody>
      )}
    </div>
  )
}
