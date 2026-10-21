import { useQueryClient } from '@tanstack/react-query'
import { Keyboard, Minimize2, Pause, Play } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  activeCueFlow,
  DEFAULT_CUE_FLOW_ID,
  followsPoint,
  MANUAL_CUE_FLOW,
  MIX_IN,
} from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import {
  BEATS_PER_BAR,
  evaluateFlow,
  flowDrops,
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
  draftDrops,
  draftPoints,
  ghostOf,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { flowName } from '../lib/cueFlowName'
import { type CueKey, cueKeyAction } from '../lib/cueKeys'
import {
  adjacentCall,
  barsToNextCall,
  callAt,
  cueClock,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  jumpBeats,
  wholeBars,
  zoomStep,
} from '../lib/cuePlayhead'
import {
  forgetDraft,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  useUnsavedCueTracks,
} from '../lib/cueSession'
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
import { CueWaveDetail, CueZoom } from './CueWaveDetail'
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
const CLEAR_CUES = 'clear-cues'

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
  remove: ignore,
  'process-current': ignore,
  'clear-meta': ignore,
  'process-all': ignore,
  'derive-tags': ignore,
}

function UnsavedMark(): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <span data-testid="cues-unsaved" className="whitespace-nowrap text-xs text-warn">
      {tr('editor.cues.unsaved')}
    </span>
  )
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
  headerSlot,
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
  headerSlot: HTMLElement | null
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
      lettersByTime: settings.cueLettersByTime,
    }),
    [read, flows, settings.cueQuantize, settings.cueLettersByTime],
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
      keptDraft(cue.contentId, draftKey) ??
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
      ),
  )
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
  const shownFlow = flows.some((f) => f.id === chosen) ? chosen : DEFAULT_CUE_FLOW_ID
  const shown = flows.find((f) => f.id === shownFlow) ?? MIX_IN
  const placing = !manual && followsPoint(shown)
  const pickMode = (id: string) => {
    setChosen(id)
    if (id !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: id })
    onFlow?.(id)
  }
  const pickOption = (id: string) => {
    if (id === CLEAR_CUES) dispatch({ type: 'clear' })
    else pickMode(id)
  }
  const removeOf = (key: string): DraftAction =>
    manual ? { type: 'remove', key } : { type: 'remove-point', key }
  const moveOf = (key: string, ms: number): DraftAction =>
    manual ? { type: 'move', key, ms } : { type: 'move-point', key, ms }
  const switchGhost = useMemo<DraftGhost | null>(
    () => (manual ? null : ghostOf(state, { type: 'apply-flow', flowId: shownFlow }, ctx)),
    [manual, state, shownFlow, ctx],
  )
  const placeOf = (c: DraftCue): string => `${c.kind === 0 ? 'call' : 'hot'}|${c.ms}|${c.color}`
  const goneCues = state.cues.filter((c) => switchGhost?.gone.includes(c.key))
  const reallyAdded = (switchGhost?.added ?? []).filter(
    (a) => !goneCues.some((g) => placeOf(g) === placeOf(a)),
  )
  const reallyGone = goneCues.filter(
    (g) => !(switchGhost?.added ?? []).some((a) => placeOf(a) === placeOf(g)),
  )
  const trackOf = { beats: ctx.beats, strong: ctx.strong, phrases: ctx.phrases }
  const placesHot =
    switchGhost !== null &&
    evaluateFlow(shown, {
      ...trackOf,
      drops: flowDrops(shown, { ...trackOf, drops: draftDrops(state.cues, state.locked) }),
    }).cues.some((c) => c.place !== 'call')
  const noFit =
    switchGhost !== null &&
    shown.rules.some((r) => r.place !== 'call') &&
    !placesHot &&
    reallyGone.some((c) => c.kind !== 0)
  const canApply =
    switchGhost !== null && !noFit && (reallyAdded.length > 0 || reallyGone.length > 0)
  const playheadGhost = useMemo<DraftGhost | null>(
    () => (placing ? ghostOf(state, { type: 'mark-drop', ms: playheadMs }, ctx) : null),
    [placing, playheadMs, state, ctx],
  )
  const [pointDrag, setPointDrag] = useState(false)
  const ghost = pointDrag
    ? undefined
    : (playheadGhost ?? ((canApply || noFit) && switchGhost !== null ? switchGhost : undefined))
  const rejectedCount = pointDrag ? 0 : (playheadGhost?.rejected.length ?? 0)
  const canMark = playheadGhost !== null && playheadGhost.added.length > 0
  const markWhy = playheadGhost?.rejected[0]?.reason
  const markHere = () => {
    if (manual) dispatch({ type: 'add-call', ms: playheadMs })
    else if (canMark) dispatch({ type: 'mark-drop', ms: playheadMs })
  }
  const noFitReason = noFit && switchGhost !== null ? switchGhost.rejected[0]?.reason : undefined
  const noFitText =
    noFitReason === undefined
      ? tr('editor.cues.noFit')
      : tr('editor.cues.noFitBecause', { reason: tr(`editor.cues.noFitReason.${noFitReason}`) })
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
  const clearable = state.cues.some((c) => !state.locked.includes(c.key))
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline)
  useEffect(() => {
    if (unchanged) forgetDraft(cue.contentId)
    else keepDraft(cue.contentId, draftKey, state)
  }, [cue.contentId, draftKey, state, unchanged])
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
  const { data: words } = useCueWaveDetail(cue.contentId, true)
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
    dispatch(removeOf(removableCall.key))
    focusEditor()
  }
  const run = (key: CueKey) => {
    if (key.type === 'play') audition.toggle(playheadMs)
    else if (key.type === 'jump')
      seekTo(jumpBeats(ctx.beats, playheadMs, key.dir * settings.cueJumpBars * BEATS_PER_BAR))
    else if (key.type === 'beat') seekTo(jumpBeats(ctx.beats, playheadMs, key.dir))
    else if (key.type === 'centre') seekTo(ctx.snapTo[nearestBeat(ctx.snapTo, playheadMs)])
    else if (key.type === 'memory') dispatch({ type: 'add-call', ms: playheadMs })
    else if (key.type === 'mark' && !manual) markHere()
    else if (key.type === 'hot') pad(key.kind)
    else if (key.type === 'remove' && selected) dispatch(removeOf(selected.key))
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
    const pressed = e.target as HTMLElement
    if (e.key === 'Enter' && !isTypingTarget(pressed) && !pressed.closest('button')) {
      e.preventDefault()
      markHere()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch(removeOf(selected.key))
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
  const pointMs = draftPoints(state, ctx)
  const points = state.cues
    .filter(
      (c) =>
        c.kind === 0 &&
        !state.locked.includes(c.key) &&
        pointMs.some((p) => Math.abs(p - c.ms) <= SAME_POSITION_MS),
    )
    .map((c) => c.key)
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
      .then(() => {
        forgetDraft(cue.contentId)
        return refreshQueued()
      })
  }
  const flowOptions = [
    ...flows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
    { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
    {
      value: CLEAR_CUES,
      label: tr('editor.cues.clearAll'),
      divided: true,
      disabled: !clearable,
    },
  ]
  const applyButton = (
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
  )
  const rejectedSlot = (
    <span
      data-testid="cues-rejected-slot"
      className="min-w-0 flex-1 whitespace-nowrap text-xs text-fg-faint"
    >
      {rejectedCount > 0 && (
        <span data-testid="cues-rejected" className="block truncate">
          {tr('editor.cues.rejectedCount', { count: rejectedCount })}
        </span>
      )}
    </span>
  )
  const discardButton = (!unchanged || queued !== null) && (
    <button
      type="button"
      data-testid="cues-undo"
      onClick={onDiscard}
      className="press whitespace-nowrap px-2 py-1.5 text-xs text-fg-dim hover:text-fg"
    >
      {tr('editor.cues.discard')}
    </button>
  )
  const actions = (
    <div data-testid="cues-actions" className="flex flex-wrap items-center gap-2">
      <Select
        testid="cues-flow"
        portal
        lead={tr('editor.cues.flow')}
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickOption}
        onClosed={maximized ? focusEditor : undefined}
        options={flowOptions}
      />
      {canApply && applyButton}
      {placing && rejectedSlot}
      <span className="flex-1" />
      {discardButton}
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
  const strip = (
    <CueWave
      wave={read.wave}
      grid={read.grid}
      quantize={settings.cueQuantize}
      durationMs={read.durationMs}
      cues={waveCues}
      selected={state.selected}
      trimmed={state.trimmed}
      ghost={ghost}
      onSelect={(key) => dispatch({ type: 'select', key })}
      onMenu={maximized ? setMenu : undefined}
      onMarkMenu={openMarkMenu}
      playheadMs={playheadMs}
      onSeek={seekTo}
      view={detailWindow(ctx.beats, playheadMs, zoom)}
      slim={!maximized}
    />
  )
  const detail = (
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
      onZoomReset={() => setZoom(DEFAULT_ZOOM_BARS)}
      ghost={ghost}
      onMarkMenu={openMarkMenu}
      onDeleteMark={(key) => dispatch(removeOf(key))}
      points={pointMs}
      movable={[
        ...points,
        ...state.cues
          .filter((c) => c.kind !== 0 && !state.locked.includes(c.key))
          .map((c) => c.key),
      ]}
      onMoveMark={(key, ms) => dispatch(moveOf(key, ms))}
      onMarkDrag={setPointDrag}
      compact={!maximized}
      onSeekClick={seekTo}
    />
  )
  const toCall = barsToNextCall(ctx.beats, pointMs, playheadMs)
  const flowControl = (
    <span data-testid="cues-flow-menu" className="min-w-0 [&_button:focus-visible]:shadow-none">
      <Select
        testid="cues-flow"
        portal
        bare
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickOption}
        options={flowOptions}
      />
    </span>
  )
  const markButton = (
    <button
      type="button"
      data-testid="cues-mark-here"
      disabled={!manual && !canMark}
      title={
        manual || canMark || playheadGhost === null
          ? undefined
          : markWhy
            ? tr(`editor.cues.noFitReason.${markWhy}`)
            : tr('editor.cues.markedHere')
      }
      onClick={() => {
        markHere()
        if (maximized) focusEditor()
      }}
      className="press h-6 shrink-0 whitespace-nowrap rounded-full bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
    >
      {manual ? tr('editor.cues.addCallShort') : tr('editor.cues.markHere')}
    </button>
  )
  const foldedRow = (
    <div
      data-testid="cues-folded-row"
      className="mt-2 flex min-w-0 items-center gap-2 whitespace-nowrap text-xs"
    >
      <button
        type="button"
        data-testid="cues-play"
        aria-label={audition.playing ? tr('editor.cues.pause') : tr('editor.cues.play')}
        onClick={() => audition.toggle(playheadMs)}
        className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg hover:bg-[var(--color-hover)]"
      >
        {audition.playing ? (
          <Pause className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
        ) : (
          <Play
            className="h-3.5 w-3.5 translate-x-px"
            fill="currentColor"
            strokeWidth={0}
            aria-hidden="true"
          />
        )}
      </button>
      <CueZoom row bars={zoom} onZoom={(dir) => setZoom((z) => zoomStep(z, dir))} />
      <span data-testid="cues-position" className="shrink-0 font-semibold tabular-nums text-fg">
        {cueClock(playheadMs)}
      </span>
      {toCall !== null && (
        <span data-testid="cue-detail-to-call" className="min-w-0 truncate text-fg-dim">
          {tr('editor.cues.toCallShort', { count: wholeBars(toCall) })}
        </span>
      )}
      {placing && rejectedSlot}
      <span className="flex-1" />
      {discardButton}
      {markButton}
      <button
        type="button"
        data-testid="cues-save"
        disabled={unchanged}
        aria-label={tr('editor.cues.save')}
        onClick={save}
        className={`press h-6 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold ${
          unchanged
            ? 'text-fg-dim'
            : 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
        }`}
      >
        {tr('editor.cues.saveShort')}
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
      {!unchanged && <UnsavedMark />}
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
      tabIndex={-1}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none focus-visible:shadow-none ${maximized ? 'my-auto flex flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && header}
      {maximized ? (
        <>
          {strip}
          {detail}
        </>
      ) : (
        <>
          <div
            data-testid="cues-surface"
            className="overflow-hidden rounded-md bg-[var(--color-panel-2)]"
          >
            <div className="border-b border-[var(--color-line)]">{strip}</div>
            {detail}
          </div>
          {foldedRow}
          {canApply && <div className="mt-2">{applyButton}</div>}
        </>
      )}
      {!maximized && headerSlot && createPortal(flowControl, headerSlot)}
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
                onClick={() => fromMarkMenu(removeOf(markTarget.key))}
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
              onClick={() => dispatch(removeOf(selected.key))}
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
      {noFit && (
        <p
          data-testid="cues-no-fit"
          title={noFitText}
          className="mt-2 truncate whitespace-nowrap text-xs text-warn"
        >
          {noFitText}
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
          mark={manual ? undefined : markButton}
          cues={state.cues}
          selected={state.selected}
          locked={state.locked}
          jumpBars={settings.cueJumpBars}
          quantize={settings.cueQuantize}
          playing={audition.playing}
          onPlay={() => audition.toggle(playheadMs)}
          onPad={pad}
          onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
          onDelete={(key) => dispatch(removeOf(key))}
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
  const unsaved = useUnsavedCueTracks().has(cue.contentId)
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
  const audition = useCueAudition(cue.path, open, follow)
  const stopSound = audition.stop
  const shownMaximized = useRef(maximized)
  useEffect(() => {
    if (shownMaximized.current === maximized) return
    shownMaximized.current = maximized
    stopSound()
  }, [maximized, stopSound])
  const [headerSlot, setHeaderSlot] = useState<HTMLSpanElement | null>(null)
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
  const [working, setWorking] = useState(false)
  const sectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const enter = () => setWorking(true)
    const leave = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setWorking(false)
    }
    el.addEventListener('focusin', enter)
    el.addEventListener('focusout', leave)
    return () => {
      el.removeEventListener('focusin', enter)
      el.removeEventListener('focusout', leave)
    }
  }, [])
  useEffect(() => {
    if (maximized || !(audition.playing || (open && working))) return
    return claimKeys({ play: () => toggle.current() })
  }, [maximized, audition.playing, open, working])
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
        headerSlot={headerSlot}
        onDiscard={() => {
          forgetDraft(cue.contentId)
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
      ref={sectionRef}
    >
      {!full && (
        <SectionHeader
          sectionId="cues"
          maximizable
          title={tr('editor.cues.title')}
          open={open}
          onToggle={onToggle}
          help={tr('editor.cues.help')}
          status={unsaved ? <UnsavedMark /> : undefined}
          statusAction={<span ref={setHeaderSlot} className="flex min-w-0 items-center" />}
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
