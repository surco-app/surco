import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  CircleAlert,
  Keyboard,
  Minimize2,
  Pause,
  Play,
  Trash2,
  Undo2,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { withBars } from '../../../shared/barPhase'
import { activeCueFlow, DEFAULT_CUE_FLOW_ID, MANUAL_CUE_FLOW } from '../../../shared/cueFlows'
import { offGridCues } from '../../../shared/cueGrid'
import type { CueJumpBars } from '../../../shared/cueJump'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { BEATS_PER_BAR, nearestBeat, SAME_POSITION_MS } from '../../../shared/cueRules'
import { type DjProgram, programOf } from '../../../shared/djProgram'
import type { DropInput, DropProposal } from '../../../shared/dropDetect'
import {
  detectedBeatNear,
  type EditableGrid,
  editAt,
  editableGridOf,
  gridAnchors,
  gridBeats,
  gridOffsets,
  pinGrid,
  sameGrid,
  shiftGrid,
} from '../../../shared/gridEdit'
import { hotCueColor } from '../../../shared/rekordboxCueColors'
import type { QueuedCues, SaveCuesRequest, SurcoGrid, TrackCues } from '../../../shared/types'
import { type CueAudition, useCueAudition } from '../hooks/useCueAudition'
import { useMaximizedSection } from '../hooks/useEditorSections'
import {
  cueDropInputQuery,
  useAuditionLead,
  useCueProfile,
  useCueWaveDetail,
  useGridFit,
  useQueuedCues,
  useSurcoGrid,
  useTrackCues,
} from '../hooks/useTrackCues'
import type { CueActions } from '../lib/commands'
import { dropsOnGrid, withoutCallInBar } from '../lib/cueAutoMark'
import type { DetailSource } from '../lib/cueDetail'
import {
  type CueDraft,
  type DraftAction,
  type DraftContext,
  type DraftCue,
  type DraftGhost,
  draftGridChanged,
  draftGridEdited,
  draftPoints,
  ghostOf,
  gridRequestOf,
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
import { CUE_PROGRAMS, cueProgramOf } from '../lib/cuePrograms'
import {
  autoMarkOf,
  cueDraftKey,
  draftsToSave,
  forgetAutoMark,
  forgetDraft,
  keepAutoMark,
  keepDraft,
  keepPlayhead,
  keptDraftOn,
  keptDrafts,
  keptOnSurcoGrid,
  keptPlayhead,
  settleCueFocus,
  useCueFocus,
  useUnsavedCueTracks,
} from '../lib/cueSession'
import { cueOutcomeOf, recordCueEdits } from '../lib/cueTasteEdits'
import { type TwinPlan, twinPlansOf } from '../lib/cueTwins'
import { quantizePoints } from '../lib/cueWave'
import { formatTime } from '../lib/duration'
import { isTypingTarget } from '../lib/keymap'
import { formatFixed } from '../lib/numberFormat'
import { isMacOS } from '../lib/platform'
import { LIBRARY_NAME } from '../lib/reviewLibraries'
import { cueLetter } from '../lib/rowCues'
import { useAppSettings } from '../lib/settingsContext'
import { formatShortcut } from '../lib/shortcuts'
import { claimKeys } from '../lib/spaceClaim'
import { CueDeck, CueMoves, DeckDivider } from './CueDeck'
import { CueGridControls } from './CueGridControls'
import { CueGridStrip } from './CueGridStrip'
import { CueOffGridBar } from './CueOffGridBar'
import { CuePalette } from './CuePalette'
import { CueWave } from './CueWave'
import { CueWaveDetail, CueZoom } from './CueWaveDetail'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { Select } from './Select'
import { SPLIT_ITEM, SPLIT_MENU, useSplitMenu } from './SplitButton'
import { Tooltip } from './Tooltip'

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
  autoUnanalysed: 'editor.cues.auto.unanalysed',
}

const ENGINE_COPY: typeof REKORDBOX_COPY = {
  save: 'editor.cues.engine.save',
  unanalysed: 'editor.cues.engine.unanalysed',
  unreadable: 'editor.cues.engine.unreadable',
  queuedStale: 'editor.cues.engine.queuedStale',
  saveFailed: 'editor.cues.engine.saveFailed',
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

const TRAKTOR_COPY: typeof REKORDBOX_COPY = {
  save: 'editor.cues.traktor.save',
  unanalysed: 'editor.cues.traktor.unanalysed',
  unreadable: 'editor.cues.traktor.unreadable',
  queuedStale: 'editor.cues.traktor.queuedStale',
  saveFailed: 'editor.cues.traktor.saveFailed',
  autoUnanalysed: 'editor.cues.traktor.autoUnreadable',
}

const SERATO_COPY: typeof REKORDBOX_COPY = {
  save: 'editor.cues.serato.save',
  unanalysed: 'editor.cues.serato.unanalysed',
  unreadable: 'editor.cues.serato.unreadable',
  queuedStale: 'editor.cues.serato.queuedStale',
  saveFailed: 'editor.cues.serato.saveFailed',
  autoUnanalysed: 'editor.cues.serato.autoUnreadable',
}

const COPY: Record<DjProgram, typeof REKORDBOX_COPY> = {
  rekordbox: REKORDBOX_COPY,
  traktor: TRAKTOR_COPY,
  engine: ENGINE_COPY,
  serato: SERATO_COPY,
}

const copyOf = (contentId: string) => COPY[programOf(contentId)]

export function saveAllKey(unsaved: ReadonlySet<string>): string {
  const programs = new Set([...unsaved].map(programOf))
  if (programs.size === 0) return CUE_PROGRAMS.rekordbox.saveAllKey
  if (programs.size === 1) return CUE_PROGRAMS[[...programs][0]].saveAllKey
  const rekordboxAndEngine =
    programs.size === 2 && programs.has('rekordbox') && programs.has('engine')
  return rekordboxAndEngine ? 'editor.cues.saveAllBoth' : 'editor.cues.saveAllMixed'
}

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
  const alt = formatShortcut(['alt'], mac)
  const keys: [string, string][] = [
    [tr('editor.cues.keys.space'), tr('editor.cues.keys.play')],
    ['← →', tr('editor.cues.keys.jump', { count: jumpBars })],
    [`${shift}← ${shift}→`, tr('editor.cues.keys.beat')],
    ['C', tr('editor.cues.keys.centre')],
    ['M', tr('editor.cues.keys.memory')],
    ['1…8', tr('editor.cues.keys.hot')],
    ['↵', tr('editor.cues.keys.enter')],
    [formatShortcut(['backspace'], mac), tr('editor.cues.keys.remove')],
    [formatShortcut(['mod', 'z'], mac), tr('editor.cues.keys.undo')],
    [formatShortcut(['shift', 'mod', 'z'], mac), tr('editor.cues.keys.redo')],
    [`${alt}← ${alt}→`, tr('editor.cues.keys.grid')],
    [`G ${shift}G`, tr('editor.cues.keys.pin')],
    ['+ −', tr('editor.cues.keys.zoom')],
    ['Esc', tr('editor.cues.keys.esc')],
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

// Where saving also places the flow: one line per other program holding the same file,
// with what it gets there, and the programs where the DJ left work unsaved, kept as it is.
function TwinRows({
  plans,
  onOverwrite,
}: {
  plans: TwinPlan[]
  onOverwrite: (contentId: string) => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (plans.length === 0) return null
  return (
    <section
      data-testid="cues-twins"
      aria-label={tr('editor.cues.twins.title')}
      className="mt-3 shrink-0 rounded-lg border border-[var(--color-line)] px-3 py-2.5 text-xs"
    >
      <p className="text-fg-dim">{tr('editor.cues.twins.title')}</p>
      <ul className="mt-2 grid gap-1.5">
        {plans.map((plan) => {
          const name = LIBRARY_NAME[plan.library]
          if (plan.status === 'unsaved')
            return (
              <li
                key={plan.contentId}
                data-testid={`cues-twin-${plan.library}-unsaved`}
                className="flex items-start gap-2"
              >
                <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                <span className="w-20 shrink-0 text-fg">{name}</span>
                <span className="grid gap-1 text-fg-muted">
                  <span>{tr('editor.cues.twins.unsaved', { program: name })}</span>
                  <button
                    type="button"
                    data-testid={`cues-twin-${plan.library}-overwrite`}
                    onClick={() => onOverwrite(plan.contentId)}
                    className="press justify-self-start text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                  >
                    {tr('editor.cues.twins.overwrite')}
                  </button>
                </span>
              </li>
            )
          if (plan.status === 'full')
            return (
              <li
                key={plan.contentId}
                data-testid={`cues-twin-${plan.library}-full`}
                className="flex items-start gap-2"
              >
                <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                <span className="w-20 shrink-0 text-fg">{name}</span>
                <span className="text-fg-muted">
                  {tr('editor.cues.twins.full', { count: plan.left })}
                </span>
              </li>
            )
          const hot = tr('editor.cues.twins.hot', { count: plan.hot })
          return (
            <li
              key={plan.contentId}
              data-testid={`cues-twin-${plan.library}`}
              className="flex items-center gap-2"
            >
              <Check
                className="h-3.5 w-3.5 shrink-0 text-good"
                strokeWidth={3}
                aria-hidden="true"
              />
              <span className="w-20 shrink-0 text-fg">{name}</span>
              <span className="text-fg-dim">
                {plan.calls > 0
                  ? tr('editor.cues.twins.both', {
                      hot,
                      calls: tr('editor.cues.twins.calls', { count: plan.calls }),
                    })
                  : hot}
                {plan.left > 0 && (
                  <span data-testid={`cues-twin-${plan.library}-left`} className="text-warn">
                    {' · '}
                    {tr('editor.cues.twins.left', { count: plan.left })}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
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
  actionsRef,
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
  actionsRef?: { current: CueActions | null }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const flows = settings.cueFlows
  const active = activeCueFlow(settings)
  const quantize: CueQuantize = provisional ? 'beat' : settings.cueQuantize
  const programGrid = useMemo(
    () => (provisional ? null : editableGridOf(read.grid)),
    [read, provisional],
  )
  const ctxRef = useRef<DraftContext | null>(null)
  const inRekordbox = useMemo(
    () => read.cues.map(({ id, ms, kind, color }) => ({ id, ms, kind, color })),
    [read],
  )
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const baseline = fresh ? queued.wanted : inRekordbox
  const [state, dispatch] = useReducer(
    (s: CueDraft, a: DraftAction) => reduceDraft(s, a, ctxRef.current as DraftContext),
    undefined,
    () =>
      keptDraftOn(cue.contentId, read, queued) ??
      startDraft(
        baseline,
        active.id,
        read.cues.filter((c) => c.loop).map((c) => c.id),
        fresh && queued.grid ? queued.grid : programGrid,
        fresh && queued.grid
          ? (queued.gridFingerprint ?? read.gridFingerprint)
          : read.gridFingerprint,
        programGrid,
      ),
  )
  const grid = useMemo(
    () =>
      state.grid && draftGridChanged(state) ? gridBeats(state.grid, read.durationMs) : read.grid,
    [state, read],
  )
  const ctx = useMemo(
    () => ({
      beats: grid.map((b) => b.ms),
      snapTo: quantizePoints(grid, quantize),
      strong: read.strong,
      phrases: read.phrases,
      flows,
      lettersByTime: settings.cueLettersByTime,
      slots: cueProgramOf(cue.contentId).slots,
    }),
    [grid, read, flows, quantize, settings.cueLettersByTime, cue.contentId],
  )
  ctxRef.current = ctx
  // A draft set on Surco's grid stays on it when rekordbox analyses the track meanwhile, so
  // its save still asks main to move the cues onto rekordbox's beats.
  const [onSurcoGrid] = useState(
    () =>
      provisional !== undefined ||
      (keptDraftOn(cue.contentId, read, queued) !== undefined && keptOnSurcoGrid(cue.contentId)),
  )
  const rekordboxGrid = programOf(cue.contentId) === 'rekordbox'
  const { fixedGrid } = cueProgramOf(cue.contentId)
  const gridOff = fixedGrid
    ? tr(fixedGrid)
    : !rekordboxGrid && (read.clockLeadMs === undefined || read.clockLeadMs === null)
      ? tr('editor.cues.grid.unmeasured')
      : provisional
        ? tr('editor.cues.grid.provisional')
        : onSurcoGrid
          ? tr('editor.cues.grid.surcoDraft')
          : state.grid === null || (!rekordboxGrid && state.grid.zones)
            ? tr('editor.cues.grid.varying')
            : null
  const gridFit = useGridFit(cue.contentId, maximized && gridOff === null)
  const offsets =
    gridFit && state.grid ? gridOffsets(ctx.beats, gridFit, playheadMs, read.durationMs) : null
  const tolerance = settings.cueGridTolerance
  const needsFix =
    offsets !== null && Math.max(Math.abs(offsets.hereMs), Math.abs(offsets.endMs)) > tolerance
  const setGrid = (next: EditableGrid) => dispatch({ type: 'set-grid', grid: next })
  const [pinned, setPinned] = useState<{ grid: EditableGrid; pins: number[] } | null>(null)
  const pins = pinned && sameGrid(pinned.grid, state.grid) ? pinned.pins : []
  const pin = (exact: boolean) => {
    if (!state.grid || gridOff !== null) return
    const detected = gridFit ? detectedBeatNear(gridFit, playheadMs) : playheadMs
    const period = gridFit ? 60000 / gridFit.bpm : 0
    const at = !exact && Math.abs(detected - playheadMs) <= period / 4 ? detected : playheadMs
    if (pins.some((p) => Math.abs(p - at) < 1)) return
    const next = pinGrid(state.grid, pins, at, rekordboxGrid)
    if (!next) return
    setGrid(next)
    setPinned({ grid: next, pins: [...pins, at].sort((a, b) => a - b) })
  }
  const fitGridTo = (next: EditableGrid) =>
    dispatch({
      type: 'fit-grid',
      grid: next,
      beats: gridBeats(next, read.durationMs).map((b) => b.ms),
    })
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
    pickMode(id)
  }
  const removeOf = (key: string): DraftAction =>
    manual ? { type: 'remove', key } : { type: 'remove-point', key }
  const moveOf = (key: string, ms: number): DraftAction =>
    manual ? { type: 'move', key, ms } : { type: 'move-point', key, ms }
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  useEffect(() => {
    if (!placing) setHoverMs(null)
  }, [placing])
  const hoverGhost = useMemo<DraftGhost | null>(
    () =>
      placing && hoverMs !== null
        ? ghostOf(state, { type: 'mark-drop', ms: hoverMs, byHand: true }, ctx)
        : null,
    [placing, hoverMs, state, ctx],
  )
  const { data: rekordboxWords } = useCueWaveDetail(cue.contentId, !provisional)
  const words = provisional ? provisional.words : rekordboxWords
  const learnsFromEdits = settings.cueLearnFromEdits
  const outcome = useMemo(
    () =>
      learnsFromEdits && words
        ? cueOutcomeOf(queryClient, cue.contentId, { cues: state.cues, locked: state.locked })
        : null,
    [learnsFromEdits, words, queryClient, cue.contentId, state.cues, state.locked],
  )
  const { readsAudio, fixedColour, collectionGate, callsNote } = cueProgramOf(cue.contentId)
  const unsavedSet = useUnsavedCueTracks()
  const { data: canSave = true } = useQuery({
    queryKey: ['traktor-can-save', settings.traktorNmlPath],
    queryFn: () => window.api.traktorCanSave(),
    enabled:
      collectionGate !== null ||
      [...unsavedSet].some((id) => cueProgramOf(id).collectionGate !== null),
  })
  const savable = (contentId: string) => canSave || cueProgramOf(contentId).collectionGate === null
  const blocked = collectionGate === 'traktor' && !canSave
  const { data: otherCollection = null } = useQuery({
    queryKey: ['traktor-collection-in-use', settings.traktorNmlPath],
    queryFn: () => window.api.traktorCollectionInUse(settings.traktorNmlPath),
    enabled: collectionGate === 'traktor' && settings.traktorNmlPath !== '',
  })
  const { data: seratoOpen = false } = useQuery({
    queryKey: ['serato-running', cue.contentId],
    queryFn: () => window.api.seratoRunning(),
    enabled: programOf(cue.contentId) === 'serato',
    staleTime: 0,
    refetchInterval: 5000,
  })
  const [readingAudio, setReadingAudio] = useState(false)
  const [proposed, setProposed] = useState<DropProposal[] | null>(() => {
    const kept = autoMarkOf(cue.contentId)
    return kept?.kind === 'proposed' ? kept.proposals : null
  })
  const taste = useCueProfile()?.profile?.taste ?? null
  const [autoNote, setAutoNote] = useState<'none' | 'marked' | 'unanalysed' | null>(() => {
    const kept = autoMarkOf(cue.contentId)
    if (kept?.kind === 'unanalysed' && readsAudio) return 'unanalysed'
    return kept?.kind === 'none' || kept?.kind === 'marked' ? kept.kind : null
  })
  const barGrid = useMemo(
    () => (provisional ? withBars(grid, words ?? null) : grid),
    [provisional, grid, words],
  )
  const proposals = useMemo(
    () => withoutCallInBar(proposed ?? [], state.cues, barGrid),
    [proposed, state.cues, barGrid],
  )
  useEffect(() => {
    if (proposals.length > 0) keepAutoMark(cue.contentId, { kind: 'proposed', proposals })
    else if (autoMarkOf(cue.contentId)?.kind === 'proposed') forgetAutoMark(cue.contentId)
  }, [cue.contentId, proposals])
  const acceptAll = useMemo<DraftAction>(
    () => ({
      type: 'batch',
      actions: proposals.map(({ ms }) =>
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
    const found = dropsOnGrid(input, barGrid, taste)
    const note =
      found.length === 0
        ? 'none'
        : withoutCallInBar(found, state.cues, barGrid).length === 0
          ? 'marked'
          : null
    if (note) keepAutoMark(cue.contentId, { kind: note })
    setAutoNote(note)
    setProposed(found)
  }
  const autoMark = () => {
    if (!readsAudio) {
      if (words) proposeFrom({ grid: barGrid, phrases: read.phrases, words })
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
  const saveAccepted = useRef(false)
  const acceptProposals = () => {
    dispatch(acceptAll)
    setProposed(null)
    saveAccepted.current = true
  }
  const dropProposal = (ms: number) => {
    setProposed((all) => (all ?? []).filter((p) => p.ms !== ms))
    focusEditor()
  }
  const acceptProposal = (ms: number) => {
    dispatch(manual ? { type: 'add-call', ms } : { type: 'mark-drop', ms })
    dropProposal(ms)
  }
  const [pointDrag, setPointDrag] = useState(false)
  const anyGhost = pointDrag ? undefined : (hoverGhost ?? proposalGhost ?? undefined)
  // A proposal is drawn as it would land: in Traktor that is the plain cue's blue, whatever
  // colour the flow's rule names.
  const ghost =
    fixedColour !== null && anyGhost
      ? {
          ...anyGhost,
          added: anyGhost.added.map((c) => (c.kind !== 0 ? { ...c, color: fixedColour } : c)),
        }
      : anyGhost
  const place = (ms: number) => dispatch({ type: 'mark-drop', ms, byHand: true })
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
  const unchanged = JSON.stringify(wanted) === JSON.stringify(baseline) && !draftGridEdited(state)
  const [overwrite, setOverwrite] = useState<ReadonlySet<string>>(new Set())
  const own = { contentId: cue.contentId, path: cue.path, label: cue.label, draft: state }
  const flowMarked = !provisional && !unchanged && Object.keys(state.origin).length > 0
  const { data: twinData = [] } = useQuery({
    queryKey: [
      'cue-twin-plans',
      cue.contentId,
      cue.path,
      wanted,
      state.origin,
      [...unsavedSet].sort(),
      [...overwrite],
      settings.cueFlowToRekordbox,
      settings.cueFlowToTraktor,
      settings.cueFlowToEngine,
      settings.cueFlowToSerato,
    ],
    queryFn: () => twinPlansOf(queryClient, [own], settings, overwrite),
    enabled: flowMarked,
  })
  const twins = flowMarked ? twinData : []
  const overwriteTwin = (contentId: string) => setOverwrite(new Set([...overwrite, contentId]))
  const twinRequests = async (drafts: Parameters<typeof twinPlansOf>[1]) =>
    (await twinPlansOf(queryClient, drafts, settings, overwrite)).flatMap((p) =>
      p.status === 'planned' && savable(p.contentId) ? [p.request] : [],
    )
  useEffect(() => {
    if (unchanged) forgetDraft(cue.contentId)
    else
      keepDraft(
        cue.contentId,
        draftKey,
        state,
        {
          path: cue.path,
          label: cue.label,
          fingerprint: read.fingerprint,
          ...(onSurcoGrid ? { provisional: true as const } : {}),
        },
        fresh ? queued : null,
      )
  }, [
    cue.contentId,
    cue.path,
    cue.label,
    read.fingerprint,
    draftKey,
    state,
    unchanged,
    onSurcoGrid,
    fresh,
    queued,
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
  const landsAs = (kind: number): number | null => {
    const next = reduceDraft(
      state,
      { type: 'add-hot', ms: playheadMs, kind },
      ctxRef.current as DraftContext,
    )
    return next.cues.find((c) => !state.cues.some((o) => o.key === c.key))?.kind ?? null
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
    else if (key.type === 'pin') pin(key.exact)
    else if (key.type === 'grid-shift' && state.grid && gridOff === null)
      setGrid(editAt(state.grid, playheadMs, (zone) => shiftGrid(zone, key.ms)) ?? state.grid)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (maximized) {
      const target = e.target as HTMLElement
      if (
        isTypingTarget(target) ||
        target.closest('[aria-haspopup="listbox"]') ||
        target.closest('[role="menu"]')
      )
        return
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
  const shownCues =
    fixedColour !== null
      ? state.cues.map((c) =>
          c.kind !== 0 && !state.locked.includes(c.key) ? { ...c, color: fixedColour } : c,
        )
      : state.cues
  const waveCues = shownCues.map((c) => ({
    ...c,
    pending: pending(c),
    locked: state.locked.includes(c.key),
  }))
  const [saveFailed, setSaveFailed] = useState(false)
  const send = async (reqs: SaveCuesRequest[]): Promise<boolean> => {
    const saved = await window.api.saveRekordboxCues(reqs).then(
      () => true,
      () => false,
    )
    setSaveFailed(!saved)
    if (!saved) return false
    setOverwrite(new Set())
    recordCueEdits(
      queryClient,
      reqs.flatMap(({ contentId }) => {
        const draft =
          contentId === cue.contentId
            ? state
            : keptDrafts().find((d) => d.contentId === contentId)?.draft
        return draft ? [{ contentId, draft }] : []
      }),
    )
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
        ...(onSurcoGrid ? { provisional: true as const } : {}),
        ...gridRequestOf(state),
      },
      ...(flowMarked ? await twinRequests([own]) : []),
    ])
    if (saved) setProposed(null)
  }
  useEffect(() => {
    if (!saveAccepted.current) return
    saveAccepted.current = false
    if (!unchanged && !blocked) void save()
  })
  const copy = copyOf(cue.contentId)
  const unsavedTracks = [...unsavedSet].filter(savable).length
  const [savingAll, setSavingAll] = useState(false)
  const saveAll = async () => {
    setSavingAll(true)
    try {
      await forgetStaleDrafts(queryClient)
      const mine = draftsToSave().filter((r) => savable(r.contentId))
      await send([
        ...mine,
        ...(await twinRequests(keptDrafts().filter((d) => savable(d.contentId)))),
      ])
    } finally {
      setSavingAll(false)
    }
  }
  const saveAllLabel = tr(saveAllKey(new Set([...unsavedSet].filter(savable))), {
    count: unsavedTracks,
  })
  const clearAll = () => {
    dispatch({ type: 'clear' })
    focusEditor()
  }
  useEffect(() => {
    if (!actionsRef) return
    actionsRef.current = {
      ...(unsavedTracks > 1
        ? { saveAll: { label: saveAllLabel, saving: savingAll, run: () => void saveAll() } }
        : {}),
      ...(maximized ? { clearAll: { enabled: clearable, run: clearAll } } : {}),
    }
    return () => {
      actionsRef.current = null
    }
  })
  const saveMenu = useSplitMenu()
  const discardable = !unchanged || queued !== null
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
      {saveAllLabel}
    </button>
  )
  const flowOptions = [
    ...flows.map((f) => ({ value: f.id, label: flowName(f, tr) })),
    { value: MANUAL_CUE_FLOW, label: tr('editor.cues.manualMode'), divided: true },
  ]
  const saveMenuShown = !!saveAllButton || discardable
  const discardButton = discardable && (
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
      disabled={state.past.length === 0}
      onClick={() => {
        dispatch({ type: 'undo' })
        if (maximized) focusEditor()
      }}
      className={`press flex shrink-0 items-center justify-center text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg disabled:pointer-events-none disabled:opacity-40 ${
        maximized ? 'h-8 w-8 rounded-lg' : 'h-6 w-6 rounded-md'
      }`}
    >
      <Tooltip label={tr('editor.cues.undo')} hint="⌘Z" />
      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
  const autoHeight = maximized ? 'h-8 rounded-lg px-3' : 'h-6 rounded-md px-2'
  const acceptLabel = tr('editor.cues.auto.acceptSave', { count: proposals.length })
  const discardLabel = tr('editor.cues.auto.discard', { count: proposals.length })
  const sureCount = proposals.filter((p) => p.sure).length
  const offGrid = provisional
    ? []
    : offGridCues(state.cues, ctx.beats, settings.cueGridTolerance).map(({ cue, driftMs }) => ({
        key: cue.key,
        kind: cue.kind,
        ms: cue.ms,
        driftMs,
      }))
  const offGridKeys = offGrid.map((o) => o.key)
  const programAnchors = programGrid ? gridAnchors(programGrid) : []
  const offGridBar = (
    <CueOffGridBar
      off={offGrid}
      spaced={!maximized}
      onShiftGrid={
        maximized && gridOff === null && state.grid && !state.grid.zones
          ? (ms) => {
              if (state.grid) setGrid(shiftGrid(state.grid, ms))
              focusEditor()
            }
          : undefined
      }
      onGo={(ms) => {
        seekTo(ms)
        focusEditor()
      }}
      onSnap={() => {
        dispatch({ type: 'snap-to-beat', keys: offGrid.map((o) => o.key) })
        focusEditor()
      }}
    />
  )
  const reviewBar = proposals.length > 0 && (
    <div
      data-testid="cues-auto-review"
      className={`flex items-center justify-between gap-3 rounded-lg border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs ${
        maximized ? 'shrink-0' : 'mb-2'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 whitespace-nowrap font-semibold text-fg">
          {tr('editor.cues.auto.count', { count: proposals.length })}
        </span>
        {sureCount > 0 && sureCount < proposals.length && (
          <span className="truncate text-fg-dim">
            {tr('editor.cues.batch.confidence', {
              sure: tr('editor.cues.batch.sure', { count: sureCount }),
              doubtful: tr('editor.cues.batch.doubtful', { count: proposals.length - sureCount }),
            })}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          data-testid="cues-auto-accept"
          aria-label={acceptLabel}
          onClick={() => {
            acceptProposals()
            focusEditor()
          }}
          className="press flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--color-accent)] px-2.5 font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          <Tooltip label={acceptLabel} />
          {tr('editor.cues.auto.acceptSave')}
          <kbd className="rounded border border-[var(--color-on-accent)]/40 px-1 font-sans text-[11px]">
            ↵
          </kbd>
        </button>
        <button
          type="button"
          data-testid="cues-auto-discard"
          aria-label={discardLabel}
          onClick={() => {
            setProposed(null)
            focusEditor()
          }}
          className="press shrink-0 whitespace-nowrap rounded px-1 text-fg-dim hover:text-fg"
        >
          <Tooltip label={discardLabel} />
          {tr('editor.cues.auto.drop')}
        </button>
      </span>
    </div>
  )
  const autoControl = (
    <button
      type="button"
      data-testid="cues-auto-mark"
      disabled={blocked ? true : readsAudio ? readingAudio : !words}
      onClick={autoMark}
      className={`press flex shrink-0 items-center gap-1.5 whitespace-nowrap bg-[var(--color-accent-soft)] text-xs font-semibold text-fg hover:bg-[var(--color-row-selected)] hover:text-[var(--color-on-row-selected)] disabled:opacity-40 ${autoHeight}`}
    >
      {!(readsAudio || words) && <Tooltip label={tr(copy.autoUnanalysed)} />}
      <svg viewBox="0 0 16 16" className="h-3 w-3 text-[var(--color-accent)]" aria-hidden="true">
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
        disabled={unchanged || blocked}
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
  const stripView = detailWindow(ctx.beats, playheadMs, zoom)
  const offView = (ms: number) => ms < stripView.fromMs || ms > stripView.toMs
  const stripGhost =
    hoverGhost && ghost
      ? {
          added: ghost.added.filter((c) => offView(c.ms)),
          gone: ghost.gone.filter((key) => {
            const cue = state.cues.find((c) => c.key === key)
            return cue !== undefined && offView(cue.ms)
          }),
          rejected: ghost.rejected?.filter((r) => offView(r.ms)),
        }
      : ghost
  const strip = (
    <CueWave
      offGrid={offGridKeys}
      anchors={state.grid && draftGridChanged(state) ? gridAnchors(state.grid) : programAnchors}
      wave={read.wave}
      grid={grid}
      quantize={quantize}
      durationMs={read.durationMs}
      cues={waveCues}
      selected={state.selected}
      trimmed={state.trimmed}
      proposals={proposals}
      onDropProposal={dropProposal}
      ghost={stripGhost}
      cursorMs={hoverGhost && ghost ? (hoverMs ?? undefined) : undefined}
      onSelect={(key) => dispatch({ type: 'select', key })}
      onMenu={maximized ? setMenu : undefined}
      onMarkMenu={openMarkMenu}
      playheadMs={playheadMs}
      onSeek={seekTo}
      view={stripView}
      slim={!maximized}
      detail={words}
    />
  )
  const detail = (
    <CueWaveDetail
      offGrid={offGridKeys}
      anchors={state.grid && draftGridChanged(state) ? gridAnchors(state.grid) : programAnchors}
      source={source}
      grid={grid}
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
    <span data-testid="cues-flow-menu" className="flex min-w-0 items-center gap-2">
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
      <button
        type="button"
        data-testid="cues-clear-all"
        aria-label={tr('editor.cues.clearAll')}
        disabled={!clearable}
        onClick={clearAll}
        className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg disabled:pointer-events-none disabled:opacity-40"
      >
        <Tooltip label={tr('editor.cues.clearAll')} />
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {undoButton}
      <div ref={saveMenu.ref} className="relative flex shrink-0">
        <button
          type="button"
          data-testid="cues-save"
          disabled={unchanged || blocked}
          aria-label={tr(copy.save)}
          onClick={() => void save()}
          className={`press h-6 shrink-0 whitespace-nowrap px-3 text-xs font-semibold ${
            saveMenuShown ? 'rounded-l-md' : 'rounded-md'
          } ${
            unchanged
              ? 'text-fg-dim'
              : 'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]'
          }`}
        >
          {tr('editor.cues.saveShort')}
        </button>
        {saveMenuShown && (
          <button
            type="button"
            data-testid="cues-save-more"
            ref={saveMenu.toggleRef}
            disabled={savingAll}
            aria-label={tr('editor.cues.saveMore')}
            aria-haspopup="menu"
            aria-expanded={saveMenu.open}
            onClick={() => saveMenu.setOpen((v) => !v)}
            className="press flex h-6 shrink-0 items-center gap-0.5 rounded-r-md border-l border-[var(--color-on-accent)]/30 bg-[var(--color-accent)] pr-2 pl-1.5 text-xs font-semibold tabular-nums text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {saveAllButton && unsavedTracks}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
        {saveMenuShown && saveMenu.open && (
          <div
            ref={saveMenu.menuRef}
            role="menu"
            aria-label={tr('editor.cues.saveMore')}
            onKeyDown={saveMenu.onMenuKeyDown}
            className={`${SPLIT_MENU} w-auto min-w-56`}
          >
            {saveAllButton && (
              <>
                <button
                  type="button"
                  data-testid="cues-save-this"
                  role="menuitem"
                  disabled={unchanged || blocked}
                  onClick={() => {
                    saveMenu.setOpen(false)
                    void save()
                  }}
                  className={`${SPLIT_ITEM} whitespace-nowrap disabled:opacity-40`}
                >
                  {tr('editor.cues.saveThis')}
                </button>
                <button
                  type="button"
                  data-testid="cues-save-all"
                  role="menuitem"
                  disabled={savingAll}
                  onClick={() => {
                    saveMenu.setOpen(false)
                    void saveAll()
                  }}
                  className={`${SPLIT_ITEM} whitespace-nowrap disabled:opacity-40`}
                >
                  {saveAllLabel}
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="cues-discard"
              role="menuitem"
              disabled={!discardable}
              onClick={() => {
                saveMenu.setOpen(false)
                onDiscard()
              }}
              className={`${SPLIT_ITEM} whitespace-nowrap disabled:opacity-40 ${
                saveAllButton ? 'mt-1 border-t border-[var(--color-line)]' : ''
              }`}
            >
              {tr('editor.cues.discard')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
  const header = (
    <div
      data-testid="cues-header"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] pb-3"
    >
      {track?.cover ? (
        <img
          data-testid="cues-cover"
          src={track.cover}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md object-cover"
        />
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
    <div data-testid="cues-toolbar" className="flex shrink-0 items-center gap-2">
      <Select
        testid="cues-flow"
        portal
        bare
        lead={tr('editor.cues.flow')}
        label={tr('editor.cues.flow')}
        value={manual ? MANUAL_CUE_FLOW : shownFlow}
        onChange={pickOption}
        onClosed={focusEditor}
        options={flowOptions}
      />
      {autoControl}
      <span className="flex-1" />
      {offsets && (
        <span
          data-testid="cues-grid-offsets"
          className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-fg-dim"
        >
          <GridOffset
            testid="cues-grid-here"
            label={tr('editor.cues.grid.here')}
            ms={offsets.hereMs}
            tolerance={tolerance}
          />
          <GridOffset
            testid="cues-grid-end"
            label={tr('editor.cues.grid.end')}
            ms={offsets.endMs}
            tolerance={tolerance}
          />
        </span>
      )}
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
      <CueMoves
        jumpBars={settings.cueJumpBars}
        quantize={quantize}
        barQuantize={!provisional}
        onJumpBars={(bars) => onJumpBars?.(bars)}
        onQuantize={(unit) => onQuantize?.(unit)}
        onDone={focusEditor}
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
          <div
            data-testid="cues-notices"
            style={{ minHeight: '36px' }}
            className="flex shrink-0 flex-col justify-center gap-1"
          >
            {reviewBar}
            {offGridBar}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {strip}
            {gridFit && state.grid && gridOff === null && (
              <CueGridStrip
                beats={ctx.beats}
                fit={gridFit}
                durationMs={read.durationMs}
                tolerance={tolerance}
                playheadMs={playheadMs}
                pins={pins}
                onSeek={seekTo}
              />
            )}
          </div>
          {detail}
          <TwinRows plans={twins} onOverwrite={overwriteTwin} />
        </>
      ) : (
        <>
          {reviewBar}
          {offGridBar}
          <div
            data-testid="cues-surface"
            className="overflow-hidden rounded-md bg-[var(--color-panel-2)]"
          >
            <div className="border-b border-[var(--color-line)]">{strip}</div>
            {detail}
          </div>
          {foldedRow}
          <TwinRows plans={twins} onOverwrite={overwriteTwin} />
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
            disabled={state.cues.filter((c) => c.kind !== 0).length >= ctx.slots.kinds.length}
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
              onClick={() => fromMenu({ type: 'mark-drop', ms: menu.ms, byHand: true })}
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
              {markTarget.kind !== 0 && fixedColour === null && (
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
          {selected.kind !== 0 && !state.locked.includes(selected.key) && fixedColour === null && (
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
      {saveFailed && (
        <p data-testid="cues-save-failed" className="mt-2 text-xs text-warn">
          {tr(copy.saveFailed)}
        </p>
      )}
      {blocked && (
        <p data-testid="cues-traktor-no-collection" className="mt-2 text-xs text-warn">
          {tr('editor.cues.traktor.noCollection')}
        </p>
      )}
      {seratoOpen && (!unchanged || queued !== null) && (
        <p data-testid="cues-serato-waiting" className="mt-2 text-xs text-warn">
          {tr('editor.cues.serato.waiting')}
        </p>
      )}
      {otherCollection && (
        <p data-testid="cues-traktor-other-collection" className="mt-2 text-xs text-warn">
          {tr('editor.cues.traktor.otherCollection', { path: otherCollection })}
        </p>
      )}
      {callsNote && state.cues.some((c) => c.kind === 0) && (
        <p data-testid={callsNote.testId} className="mt-2 text-xs text-fg-dim">
          {tr(callsNote.key)}
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
      {(outcome === 'corrected' || outcome === 'manual') && (
        <p data-testid="cues-auto-outcome" className="mt-2 text-xs text-fg-dim">
          {tr(outcome === 'corrected' ? 'editor.cues.auto.changed' : 'editor.cues.auto.own')}
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
          cues={shownCues}
          kinds={ctx.slots.kinds}
          selected={state.selected}
          locked={state.locked}
          playing={audition.playing}
          onPlay={() => audition.toggle(playheadMs)}
          onPad={pad}
          onRecolour={
            fixedColour !== null
              ? undefined
              : (key, color) => dispatch({ type: 'recolour', key, color })
          }
          onDelete={(key) => dispatch(removeOf(key))}
          onMemory={() => dispatch({ type: 'add-call', ms: playheadMs })}
          onMemoryStep={memoryStep}
          onMemoryRemove={memoryRemove}
          canRemoveMemory={removableCall !== undefined && !state.locked.includes(removableCall.key)}
          onClearAll={clearAll}
          canClearAll={clearable}
          landsAs={settings.cueLettersByTime ? landsAs : undefined}
          onDone={focusEditor}
          gridControls={
            <>
              <CueGridControls
                grid={state.grid}
                disabledReason={gridOff}
                fit={gridFit}
                needsFix={needsFix}
                playheadMs={playheadMs}
                onChange={setGrid}
                onFit={fitGridTo}
                onDone={focusEditor}
                zones={rekordboxGrid}
                onPin={pin}
              />
              <DeckDivider />
              <CueZoom
                row
                bars={zoom}
                onZoom={(dir) => setZoom((z) => zoomStep(z, dir))}
                onReset={() => setZoom(DEFAULT_ZOOM_BARS)}
              />
            </>
          }
        />
      )}
    </fieldset>
  )
}

const signedMs = (ms: number): string => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`

function GridOffset({
  testid,
  label,
  ms,
  tolerance,
}: {
  testid: string
  label: string
  ms: number
  tolerance: number
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${Math.abs(ms) > tolerance ? 'bg-warn' : 'bg-good'}`}
      />
      {label}
      <span
        data-testid={testid}
        style={{ display: 'inline-block', minWidth: '7ch' }}
        className="font-semibold tabular-nums text-fg"
      >
        {signedMs(ms)}
      </span>
    </span>
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
  actionsRef,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
  track?: CueTrackInfo
  onJumpBars?: (bars: CueJumpBars) => void
  onQuantize?: (unit: CueQuantize) => void
  onFlow?: (id: string) => void
  actionsRef?: { current: CueActions | null }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  const wantsSurcoGrid = !!read && !read.analysed && cueProgramOf(cue.contentId).surcoGrid
  const { colourHelp } = cueProgramOf(cue.contentId)
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
  const pauseSound = audition.pause
  const shownMaximized = useRef(maximized)
  useEffect(() => {
    if (shownMaximized.current === maximized) return
    shownMaximized.current = maximized
    pauseSound()
  }, [maximized, pauseSound])
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
        actionsRef={actionsRef}
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
          help={[
            tr('editor.cues.help'),
            ...(provisional ? [tr('editor.cues.provisional.help')] : []),
            ...(colourHelp ? [tr(colourHelp)] : []),
          ].join(' ')}
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
