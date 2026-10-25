import { useQueryClient } from '@tanstack/react-query'
import { Check, Keyboard, Minimize2, Pause, Play, Trash2, Undo2, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { activeCueFlow, DEFAULT_CUE_FLOW_ID, MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import {
  BEATS_PER_BAR,
  MAX_HOT_CUES,
  nearestBeat,
  SAME_POSITION_MS,
} from '../../../shared/cueRules'
import type { DropInput } from '../../../shared/dropDetect'
import { isEngineContent } from '../../../shared/engineContent'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import type {
  QueuedCues,
  SaveCuesOutcome,
  SaveCuesRequest,
  SurcoGrid,
  TrackCues,
} from '../../../shared/types'
import { type CueAudition, useCueAudition } from '../hooks/useCueAudition'
import { useMaximizedSection } from '../hooks/useEditorSections'
import {
  cueDropInputQuery,
  useAuditionLead,
  useCueWaveDetail,
  useQueuedCues,
  useSurcoGrid,
  useTrackCues,
} from '../hooks/useTrackCues'
import { dropsOnGrid, withoutCallInBar } from '../lib/cueAutoMark'
import type { DetailSource } from '../lib/cueDetail'
import {
  type CueDraft,
  type DraftAction,
  type DraftCue,
  type DraftGhost,
  draftPoints,
  ghostOf,
  reduceDraft,
  startDraft,
  wantedOfDraft,
} from '../lib/cueDraft'
import { forgetStaleDrafts } from '../lib/cueDrafts'
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
  autoMarkOf,
  cueDraftKey,
  draftsToSave,
  forgetAutoMark,
  forgetDraft,
  keepAutoMark,
  keepDraft,
  keepPlayhead,
  keptDraft,
  keptPlayhead,
  settleCueFocus,
  useCueFocus,
  useUnsavedCueTracks,
} from '../lib/cueSession'
import { quantizePoints } from '../lib/cueWave'
import { formatTime } from '../lib/duration'
import { isTypingTarget } from '../lib/keymap'
import { formatFixed } from '../lib/numberFormat'
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

const REKORDBOX_COPY = {
  save: 'editor.cues.save',
  unanalysed: 'editor.cues.unanalysed',
  unreadable: 'editor.cues.unreadable',
  queuedStale: 'editor.cues.queuedStale',
  saveFailed: 'editor.cues.saveFailed',
  otherLibrary: 'sources.edit.refused.otherCollection',
  autoUnanalysed: 'editor.cues.auto.unanalysed',
}

const ENGINE_COPY: typeof REKORDBOX_COPY = {
  save: 'editor.cues.engine.save',
  unanalysed: 'editor.cues.engine.unanalysed',
  unreadable: 'editor.cues.engine.unreadable',
  queuedStale: 'editor.cues.engine.queuedStale',
  saveFailed: 'editor.cues.engine.saveFailed',
  otherLibrary: 'engineQueue.otherLibrary',
  autoUnanalysed: 'editor.cues.engine.autoUnreadable',
}

function ProvisionalMark({ bpm }: { bpm: number }): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  return (
    <span
      data-testid="cues-provisional"
      className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-fg"
    >
      {tr('editor.cues.provisional.chip', { bpm: formatFixed(bpm, 2, i18n.language) })}
    </span>
  )
}

const copyOf = (contentId: string) => (isEngineContent(contentId) ? ENGINE_COPY : REKORDBOX_COPY)

function saveAllKey(unsaved: ReadonlySet<string>): string {
  const engine = [...unsaved].filter(isEngineContent).length
  if (engine === 0) return 'editor.cues.saveAll'
  return engine === unsaved.size ? 'editor.cues.engine.saveAll' : 'editor.cues.saveAllBoth'
}
const CLEAR_CUES = 'clear-cues'
const DISCARD_CUES = 'discard-cues'

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
        className="press flex h-8 w-8 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
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
  provisional,
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
  provisional?: SurcoGrid
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const quantize: CueQuantize = provisional ? 'beat' : settings.cueQuantize
  const ctx = useMemo(
    () => ({
      beats: read.grid.map((b) => b.ms),
      snapTo: quantizePoints(read.grid, quantize),
      strong: read.strong,
      phrases: read.phrases,
      flows,
      lettersByTime: settings.cueLettersByTime,
    }),
    [read, flows, quantize, settings.cueLettersByTime],
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
  const placing = !manual
  const pickMode = (id: string) => {
    setChosen(id)
    if (id !== MANUAL_CUE_FLOW) dispatch({ type: 'use-flow', flowId: id })
    onFlow?.(id)
  }
  const pickOption = (id: string) => {
    if (id === CLEAR_CUES) dispatch({ type: 'clear' })
    else if (id === DISCARD_CUES) onDiscard()
    else pickMode(id)
  }
  const removeOf = (key: string): DraftAction =>
    manual ? { type: 'remove', key } : { type: 'remove-point', key }
  const moveOf = (key: string, ms: number): DraftAction =>
    manual ? { type: 'move', key, ms } : { type: 'move-point', key, ms }
  const playheadGhost = useMemo<DraftGhost | null>(
    () => (placing ? ghostOf(state, { type: 'mark-drop', ms: playheadMs }, ctx) : null),
    [placing, playheadMs, state, ctx],
  )
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  useEffect(() => {
    if (!placing) setHoverMs(null)
  }, [placing])
  const hoverGhost = useMemo<DraftGhost | null>(
    () =>
      placing && hoverMs !== null ? ghostOf(state, { type: 'mark-drop', ms: hoverMs }, ctx) : null,
    [placing, hoverMs, state, ctx],
  )
  const { data: rekordboxWords } = useCueWaveDetail(cue.contentId, !provisional)
  const words = provisional ? provisional.words : rekordboxWords
  const engine = isEngineContent(cue.contentId)
  const [readingAudio, setReadingAudio] = useState(false)
  const [proposed, setProposed] = useState<number[] | null>(() => {
    const kept = autoMarkOf(cue.contentId)
    return kept?.kind === 'proposed' ? kept.ms : null
  })
  const [autoNote, setAutoNote] = useState<'none' | 'marked' | 'unanalysed' | null>(() => {
    const kept = autoMarkOf(cue.contentId)
    if (kept?.kind === 'unanalysed' && engine) return 'unanalysed'
    return kept?.kind === 'none' || kept?.kind === 'marked' ? kept.kind : null
  })
  const proposals = useMemo(
    () => withoutCallInBar(proposed ?? [], state.cues, read.grid),
    [proposed, state.cues, read.grid],
  )
  useEffect(() => {
    if (proposals.length > 0) keepAutoMark(cue.contentId, { kind: 'proposed', ms: proposals })
    else if (autoMarkOf(cue.contentId)?.kind === 'proposed') forgetAutoMark(cue.contentId)
  }, [cue.contentId, proposals])
  const acceptAll = useMemo<DraftAction>(
    () => ({
      type: 'batch',
      actions: proposals.map((ms) =>
        manual ? { type: 'add-call', ms } : { type: 'mark-drop', ms },
      ),
    }),
    [proposals, manual],
  )
  const proposalGhost = useMemo<DraftGhost | null>(
    () => (proposals.length > 0 ? ghostOf(state, acceptAll, ctx) : null),
    [proposals, acceptAll, state, ctx],
  )
  const proposeFrom = (input: DropInput) => {
    const found = dropsOnGrid(input, read.grid)
    const note =
      found.length === 0
        ? 'none'
        : withoutCallInBar(found, state.cues, read.grid).length === 0
          ? 'marked'
          : null
    if (note) keepAutoMark(cue.contentId, { kind: note })
    setAutoNote(note)
    setProposed(found)
  }
  const autoMark = () => {
    if (!engine) {
      if (words) proposeFrom({ grid: read.grid, phrases: read.phrases, words })
      return
    }
    setReadingAudio(true)
    void queryClient
      .fetchQuery(cueDropInputQuery(cue.contentId))
      .catch(() => null)
      .then((input) => {
        setReadingAudio(false)
        if (input) {
          proposeFrom(input)
          return
        }
        keepAutoMark(cue.contentId, { kind: 'unanalysed' })
        setAutoNote('unanalysed')
      })
  }
  const acceptProposals = () => {
    dispatch(acceptAll)
    setProposed(null)
  }
  const dropProposal = (ms: number) => {
    setProposed((all) => (all ?? []).filter((p) => p !== ms))
    focusEditor()
  }
  const acceptProposal = (ms: number) => {
    dispatch(manual ? { type: 'add-call', ms } : { type: 'mark-drop', ms })
    dropProposal(ms)
  }
  const [pointDrag, setPointDrag] = useState(false)
  const ghost = pointDrag ? undefined : (hoverGhost ?? proposalGhost ?? playheadGhost ?? undefined)
  const place = (ms: number) => dispatch({ type: 'mark-drop', ms })
  const markHere = () => {
    if (manual) dispatch({ type: 'add-call', ms: playheadMs })
    else if (placing) place(playheadMs)
  }
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
    else
      keepDraft(cue.contentId, draftKey, state, {
        path: cue.path,
        label: cue.label,
        fingerprint: read.fingerprint,
        ...(provisional ? { provisional: true as const } : {}),
      })
  }, [
    cue.contentId,
    cue.path,
    cue.label,
    read.fingerprint,
    draftKey,
    state,
    unchanged,
    provisional,
  ])
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
    else if (key.type === 'mark' && proposals.length > 0) acceptProposals()
    else if (key.type === 'mark' && !manual) markHere()
    else if (key.type === 'hot') pad(key.kind)
    else if (key.type === 'remove' && selected) dispatch(removeOf(selected.key))
    else if (key.type === 'undo') dispatch({ type: 'undo' })
    else if (key.type === 'redo') dispatch({ type: 'redo' })
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
      if (proposals.length > 0) acceptProposals()
      else markHere()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
      e.preventDefault()
      dispatch(removeOf(selected.key))
    } else if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
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
  const [saveFailed, setSaveFailed] = useState<SaveCuesOutcome | 'failed' | null>(null)
  const send = async (reqs: SaveCuesRequest[]): Promise<boolean> => {
    const outcome = await window.api.saveRekordboxCues(reqs).catch(() => 'failed' as const)
    if (outcome !== 'queued') {
      setSaveFailed(outcome)
      return false
    }
    setSaveFailed(null)
    for (const req of reqs) forgetDraft(req.contentId)
    await refreshQueued()
    return true
  }
  const save = async () => {
    const saved = await send([
      {
        contentId: cue.contentId,
        path: cue.path,
        label: cue.label,
        wanted,
        fingerprint: read.fingerprint,
        ...(provisional ? { provisional: true as const } : {}),
      },
    ])
    if (saved) setProposed(null)
  }
  const copy = copyOf(cue.contentId)
  const unsavedSet = useUnsavedCueTracks()
  const unsavedTracks = unsavedSet.size
  const [savingAll, setSavingAll] = useState(false)
  const saveAll = async () => {
    setSavingAll(true)
    try {
      await forgetStaleDrafts(queryClient)
      await send(draftsToSave())
    } finally {
      setSavingAll(false)
    }
  }
  const saveAllButton = unsavedTracks > 1 && (
    <button
      type="button"
      data-testid="cues-save-all"
      disabled={savingAll}
      onClick={() => void saveAll()}
      className={`press shrink-0 disabled:opacity-40 whitespace-nowrap border border-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-hover)] ${
        maximized ? 'h-8 rounded-lg' : 'h-6 rounded-full'
      }`}
    >
      {tr(saveAllKey(unsavedSet), { count: unsavedTracks })}
    </button>
  )
  const flowOptions = [
    ...flows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
    { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
    {
      value: CLEAR_CUES,
      label: tr('editor.cues.clearAll'),
      divided: true,
      disabled: !clearable,
    },
    ...(maximized
      ? []
      : [
          {
            value: DISCARD_CUES,
            label: tr('editor.cues.discard'),
            disabled: unchanged && queued === null,
          },
        ]),
  ]
  const discardButton = (!unchanged || queued !== null) && (
    <button
      type="button"
      data-testid="cues-undo"
      onClick={onDiscard}
      className={`press shrink-0 whitespace-nowrap text-xs text-fg-dim hover:text-fg ${
        maximized ? 'h-8 rounded-lg px-3 hover:bg-[var(--color-hover)]' : 'px-2 py-1.5'
      }`}
    >
      {tr('editor.cues.discard')}
    </button>
  )
  const undoButton = (
    <button
      type="button"
      data-testid="cues-step-back"
      aria-label={tr('editor.cues.undo')}
      title={`${tr('editor.cues.undo')} ⌘Z`}
      disabled={state.past.length === 0}
      onClick={() => {
        dispatch({ type: 'undo' })
        if (maximized) focusEditor()
      }}
      className={`press flex shrink-0 items-center justify-center text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg disabled:pointer-events-none disabled:opacity-40 ${
        maximized ? 'h-8 w-8 rounded-lg' : 'h-6 w-6 rounded-md'
      }`}
    >
      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
  const autoHeight = maximized ? 'h-8 rounded-lg px-3' : 'h-6 rounded-md px-2'
  const acceptLabel = tr('editor.cues.auto.accept', { count: proposals.length })
  const autoControl =
    proposals.length > 0 ? (
      <>
        <button
          type="button"
          data-testid="cues-auto-accept"
          aria-label={maximized ? undefined : acceptLabel}
          title={maximized ? undefined : acceptLabel}
          onClick={() => {
            acceptProposals()
            if (maximized) focusEditor()
          }}
          className={`press flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-dashed border-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-hover)] ${autoHeight}`}
        >
          {maximized ? (
            acceptLabel
          ) : (
            <>
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
              {proposals.length}
            </>
          )}
          <kbd className="rounded border border-[var(--color-accent)] px-1 font-sans text-[10px]">
            ↵
          </kbd>
        </button>
        <button
          type="button"
          data-testid="cues-auto-discard"
          aria-label={maximized ? undefined : tr('editor.cues.auto.discard')}
          title={maximized ? undefined : tr('editor.cues.auto.discard')}
          onClick={() => {
            setProposed(null)
            if (maximized) focusEditor()
          }}
          className="press flex shrink-0 items-center whitespace-nowrap px-1 text-xs text-fg-dim hover:text-fg"
        >
          {maximized ? (
            tr('editor.cues.auto.discard')
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </>
    ) : (
      <button
        type="button"
        data-testid="cues-auto-mark"
        disabled={provisional ? true : engine ? readingAudio : !words}
        title={
          provisional
            ? tr('editor.cues.provisional.auto')
            : engine || words
              ? undefined
              : tr(copy.autoUnanalysed)
        }
        onClick={autoMark}
        className={`press flex shrink-0 items-center gap-1.5 whitespace-nowrap border border-[var(--color-accent)] text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-hover)] disabled:opacity-40 ${autoHeight}`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
          <path d="M8 1 9.6 6.4 15 8 9.6 9.6 8 15 6.4 9.6 1 8 6.4 6.4Z" fill="currentColor" />
        </svg>
        {readingAudio ? tr('editor.cues.engine.autoReading') : tr('editor.cues.auto.button')}
      </button>
    )
  const actions = (
    <div data-testid="cues-actions" className="flex shrink-0 items-center gap-1">
      {!unchanged && <UnsavedMark />}
      {undoButton}
      {discardButton}
      {saveAllButton}
      <button
        type="button"
        data-testid="cues-save"
        disabled={unchanged}
        aria-label={maximized ? undefined : tr(copy.save)}
        onClick={() => void save()}
        className={`press ml-1 h-8 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold ${
          unchanged
            ? 'border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg opacity-40'
            : 'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
        }`}
      >
        {maximized ? tr(copy.save) : tr('editor.cues.saveShort')}
      </button>
    </div>
  )
  const strip = (
    <CueWave
      wave={read.wave}
      grid={read.grid}
      quantize={quantize}
      durationMs={read.durationMs}
      cues={waveCues}
      selected={state.selected}
      trimmed={state.trimmed}
      proposals={proposals}
      ghost={ghost}
      onSelect={(key) => dispatch({ type: 'select', key })}
      onMenu={maximized ? setMenu : undefined}
      onMarkMenu={openMarkMenu}
      playheadMs={playheadMs}
      onSeek={seekTo}
      view={detailWindow(ctx.beats, playheadMs, zoom)}
      slim={!maximized}
      detail={words}
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
      quantize={quantize}
      onScrub={seekTo}
      onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
      ghost={ghost}
      onMarkMenu={openMarkMenu}
      onDeleteMark={(key) => dispatch(removeOf(key))}
      movable={[
        ...points,
        ...state.cues
          .filter((c) => c.kind !== 0 && !state.locked.includes(c.key))
          .map((c) => c.key),
      ]}
      onMoveMark={(key, ms) => dispatch(moveOf(key, ms))}
      onMarkDrag={setPointDrag}
      compact={!maximized}
      onPlace={placing ? place : undefined}
      onHover={placing ? setHoverMs : undefined}
      proposals={proposals}
      onAcceptProposal={acceptProposal}
      onDropProposal={dropProposal}
    />
  )
  const toCall = barsToNextCall(ctx.beats, pointMs, playheadMs)
  const flowControl = (
    <span
      data-testid="cues-flow-menu"
      className="flex min-w-0 items-center gap-2 [&_button:focus-visible]:shadow-none"
    >
      <Select
        testid="cues-flow"
        portal
        bare
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickOption}
        options={flowOptions}
      />
      {autoControl}
    </span>
  )
  const addCallButton = manual && (
    <button
      type="button"
      data-testid="cues-add-call"
      onClick={markHere}
      className="press h-6 shrink-0 whitespace-nowrap rounded-full bg-[var(--color-accent)] px-3 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
    >
      {tr('editor.cues.addCallShort')}
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
      <CueZoom
        row
        bars={zoom}
        onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
        onReset={() => setZoom(DEFAULT_ZOOM_BARS)}
      />
      <span data-testid="cues-position" className="shrink-0 font-semibold tabular-nums text-fg">
        {cueClock(playheadMs)}
      </span>
      {toCall !== null && (
        <span data-testid="cue-detail-to-call" className="min-w-0 truncate text-fg-dim">
          {tr('editor.cues.toCallShort', { count: wholeBars(toCall) })}
        </span>
      )}
      <span className="flex-1" />
      {addCallButton}
      {undoButton}
      <button
        type="button"
        data-testid="cues-save"
        disabled={unchanged}
        aria-label={tr(copy.save)}
        onClick={() => void save()}
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
    <div
      data-testid="cues-header"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] pb-3"
    >
      {track?.cover ? (
        <img src={track.cover} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="h-10 w-10 shrink-0 rounded-md bg-[var(--color-panel-2)]"
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="truncate text-[15px] font-semibold text-fg">
          {track?.title || cue.label}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {track?.artist && <span className="truncate text-fg-dim">{track.artist}</span>}
          <div
            data-testid="cues-meta"
            className="flex shrink-0 items-center gap-1.5 tabular-nums text-fg-faint"
          >
            {track?.artist && <span aria-hidden="true">·</span>}
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
          {provisional && <ProvisionalMark bpm={provisional.bpm} />}
        </div>
      </div>
      <span className="flex-1" />
      {actions}
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line-strong)]" />
      <CueKeys jumpBars={settings.cueJumpBars} onClose={focusEditor} />
      <button
        type="button"
        data-testid="section-maximize"
        aria-label={tr('editor.sectionRestore')}
        aria-pressed="true"
        onClick={onRestore}
        className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg"
      >
        <Minimize2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
  const toolbar = (
    <div data-testid="cues-toolbar" className="mt-auto flex shrink-0 items-center gap-2">
      <Select
        testid="cues-flow"
        portal
        lead={tr('editor.cues.flow')}
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickOption}
        onClosed={focusEditor}
        options={flowOptions}
      />
      {autoControl}
      <button
        type="button"
        data-testid="cues-clear-all"
        disabled={!clearable}
        onClick={() => {
          dispatch({ type: 'clear' })
          focusEditor()
        }}
        className="press flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg disabled:pointer-events-none disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {tr('editor.cues.clearAll')}
      </button>
      <span className="flex-1" />
      <span
        data-testid="cues-position"
        className="shrink-0 text-[13px] font-semibold tabular-nums text-fg"
      >
        {cueClock(playheadMs)}
      </span>
      {toCall !== null && (
        <span
          data-testid="cue-detail-to-call"
          className="shrink-0 whitespace-nowrap text-xs text-fg-dim"
        >
          {tr('editor.cues.toCall', { count: wholeBars(toCall) })}
        </span>
      )}
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line-strong)]" />
      <CueZoom
        row
        bars={zoom}
        onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
        onReset={() => setZoom(DEFAULT_ZOOM_BARS)}
      />
    </div>
  )
  return (
    <fieldset
      ref={editorRef}
      data-testid="cues-editor"
      data-maximized={maximized ? 'true' : 'false'}
      tabIndex={-1}
      aria-label={tr('editor.cues.title')}
      className={`relative m-0 min-w-0 border-0 p-0 outline-none focus-visible:shadow-none ${maximized ? 'flex min-h-0 flex-1 flex-col gap-3' : ''}`}
      onKeyDown={onKey}
    >
      {maximized && header}
      {maximized ? (
        <>
          {toolbar}
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
          {saveAllButton && <div className="mt-2 flex justify-end">{saveAllButton}</div>}
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
          {tr(copy.queuedStale)}
        </p>
      )}
      {saveFailed !== null && (
        <p data-testid="cues-save-failed" className="mt-2 text-xs text-warn">
          {tr(saveFailed === 'other-collection' ? copy.otherLibrary : copy.saveFailed)}
        </p>
      )}
      {copy === ENGINE_COPY && state.cues.some((c) => c.kind === 0) && (
        <p data-testid="cues-engine-calls" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.engine.calls')}
        </p>
      )}
      {autoNote === 'none' && (
        <p data-testid="cues-auto-none" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.auto.none')}
        </p>
      )}
      {autoNote === 'unanalysed' && (
        <p data-testid="cues-auto-unreadable" className="mt-2 text-xs text-fg-dim">
          {tr(copy.autoUnanalysed)}
        </p>
      )}
      {autoNote === 'marked' && (
        <p data-testid="cues-auto-marked" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.auto.marked')}
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
        <div className="mb-auto">
          <CueDeck
            cues={state.cues}
            selected={state.selected}
            locked={state.locked}
            jumpBars={settings.cueJumpBars}
            quantize={quantize}
            barQuantize={!provisional}
            playing={audition.playing}
            onPlay={() => audition.toggle(playheadMs)}
            onPad={pad}
            onRecolour={(key, color) => dispatch({ type: 'recolour', key, color })}
            onDelete={(key) => dispatch(removeOf(key))}
            onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
            onMemoryStep={memoryStep}
            onMemoryRemove={memoryRemove}
            canRemoveMemory={
              removableCall !== undefined && !state.locked.includes(removableCall.key)
            }
            onJumpBars={(bars) => onJumpBars?.(bars)}
            onQuantize={(unit) => onQuantize?.(unit)}
            onDone={focusEditor}
          />
        </div>
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
  const wantsSurcoGrid = !!read && !read.analysed && !isEngineContent(cue.contentId)
  const { data: surco } = useSurcoGrid(cue.contentId, wantsSurcoGrid)
  const provisional = wantsSurcoGrid && surco ? surco : undefined
  const shown = read && provisional ? { ...read, analysed: true, grid: provisional.grid } : read
  const { maximized: whole, setMaximized } = useMaximizedSection()
  const maximized = open && whole === 'cues'
  const unsaved = useUnsavedCueTracks().has(cue.contentId)
  const [round, setRound] = useState(0)
  const draftKey = cueDraftKey(cue.contentId, read?.fingerprint ?? '', queued)
  const [head, setHead] = useState(() => ({
    contentId: cue.contentId,
    ms: keptPlayhead(cue.contentId),
  }))
  const playheadMs = head.contentId === cue.contentId ? head.ms : 0
  const follow = (ms: number) => {
    setHead({ contentId: cue.contentId, ms })
    keepPlayhead(cue.contentId, ms)
  }
  const leadMs = useAuditionLead(cue.contentId)
  const audition = useCueAudition(cue.path, open, follow, leadMs)
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
  const focus = useCueFocus()
  const moveHeadRef = useRef(moveHead)
  moveHeadRef.current = moveHead
  useEffect(() => {
    if (focus?.contentId !== cue.contentId) return
    settleCueFocus()
    moveHeadRef.current(focus.ms)
  }, [focus, cue.contentId])
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
    shown !== undefined &&
    shown !== null &&
    queued !== undefined &&
    shown.analysed &&
    shown.grid.length > 0
  const full = maximized && editable
  const body =
    isError || shown === null ? (
      <p data-testid="cues-unreadable" className="text-xs text-fg-dim">
        {tr(copyOf(cue.contentId).unreadable)}
      </p>
    ) : shown === undefined || queued === undefined ? null : wantsSurcoGrid &&
      surco === undefined ? (
      <p data-testid="cues-measuring" className="text-xs text-fg-dim">
        {tr('editor.cues.provisional.measuring')}
      </p>
    ) : !shown.analysed || shown.grid.length === 0 ? (
      <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
        {tr(copyOf(cue.contentId).unanalysed)}
      </p>
    ) : (
      <Editing
        key={`${draftKey}|${round}`}
        read={shown}
        provisional={provisional}
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
          help={
            provisional
              ? `${tr('editor.cues.help')} ${tr('editor.cues.provisional.help')}`
              : tr('editor.cues.help')
          }
          status={
            unsaved || provisional ? (
              <>
                {provisional && <ProvisionalMark bpm={provisional.bpm} />}
                {unsaved && <UnsavedMark />}
              </>
            ) : undefined
          }
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
