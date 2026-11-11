import { ChevronLeft, ChevronRight, Pause, Play, Plus, Trash2, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { CUE_QUANTIZE, type CueQuantize } from '../../../shared/cueQuantize'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor, PAD_LETTER_COLOR } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'
import { CueDeleteBadge } from './CueDeleteBadge'
import { CuePalette } from './CuePalette'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

export interface DeckCue {
  key: string
  kind: number
  color: number | null
}

const STEP =
  'press flex h-7 w-7 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg'

export function CueDeck({
  cues,
  kinds = HOT_KINDS,
  selected,
  locked,
  playing,
  onPlay,
  onPad,
  onRecolour,
  onDelete,
  onMemory,
  onMemoryStep,
  onMemoryRemove,
  canRemoveMemory,
  onClearAll,
  canClearAll = false,
  landsAs,
  onDone,
  gridControls,
}: {
  cues: DeckCue[]
  kinds?: number[]
  selected: string | null
  locked: string[]
  playing: boolean
  onPlay: () => void
  onPad: (kind: number) => void
  // Absent where the library keeps no colour of its own (Traktor), so no palette opens.
  onRecolour?: (key: string, color: number) => void
  onDelete?: (key: string) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onMemoryRemove: () => void
  canRemoveMemory: boolean
  onClearAll?: () => void
  canClearAll?: boolean
  landsAs?: (kind: number) => number | null
  onDone?: () => void
  gridControls?: React.ReactNode
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [colouring, setColouring] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (colouring === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setColouring(null)
      onDone?.()
    }
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setColouring(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [colouring, onDone])
  return (
    <div data-testid="cues-deck" className="mt-3 flex shrink-0 items-center gap-x-2">
      <button
        type="button"
        data-testid="cues-play"
        aria-label={playing ? tr('editor.cues.pause') : tr('editor.cues.play')}
        onClick={onPlay}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg transition-colors hover:bg-[var(--color-line-strong)]"
      >
        {playing ? (
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
      <DeckDivider />
      <div className="flex items-center gap-1">
        {kinds.map((kind) => {
          const cue = cues.find((c) => c.kind === kind)
          const letter = cueLetter(kind)
          const isSelected = cue !== undefined && cue.key === selected
          const lands = !cue && landsAs ? landsAs(kind) : null
          return (
            <span key={kind} className="relative">
              <button
                type="button"
                data-testid={`cues-pad-${letter}`}
                data-set={cue ? 'true' : 'false'}
                aria-label={tr('editor.cues.selectedHot', { letter })}
                aria-pressed={isSelected}
                onClick={() => onPad(kind)}
                onMouseEnter={() => setHovered(cue?.key ?? null)}
                onMouseLeave={() => setHovered(null)}
                onKeyDown={(e) => {
                  if (!cue || locked.includes(cue.key)) return
                  if (e.key !== 'Backspace' && e.key !== 'Delete') return
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete?.(cue.key)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (cue && onRecolour && !locked.includes(cue.key)) setColouring(cue.key)
                }}
                style={
                  cue
                    ? { backgroundColor: hotCueColor(cue.color), color: PAD_LETTER_COLOR }
                    : undefined
                }
                className={`press flex h-7 w-7 items-center justify-center rounded-[7px] text-xs font-semibold ${
                  cue ? '' : 'border border-dashed border-[var(--color-line-strong)] text-fg-faint'
                } ${isSelected ? 'outline outline-2 outline-offset-2 outline-[var(--color-fg)]' : ''}`}
              >
                {lands !== null && (
                  <Tooltip label={tr('editor.cues.padLands', { letter: cueLetter(lands) })} />
                )}
                {letter}
              </button>
              {cue && onDelete && hovered === cue.key && !locked.includes(cue.key) && (
                <CueDeleteBadge
                  testId={`cues-pad-${letter}-delete`}
                  label={tr('editor.cues.deleteHot', { letter })}
                  onDelete={() => onDelete(cue.key)}
                  onMouseEnter={() => setHovered(cue.key)}
                  onMouseLeave={() => setHovered(null)}
                  className="-top-1 -right-1"
                />
              )}
              {cue && colouring === cue.key && (
                <div
                  ref={popoverRef}
                  data-testid="cues-pad-colours"
                  className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-2.5 shadow-[var(--shadow-float)]"
                >
                  <CuePalette
                    value={cue.color}
                    onPick={(color) => {
                      onRecolour?.(cue.key, color)
                      setColouring(null)
                      onDone?.()
                    }}
                    label={(index) => tr('editor.cues.colour', { index })}
                  />
                </div>
              )}
            </span>
          )
        })}
      </div>
      <DeckDivider />
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          data-testid="cues-memory-prev"
          aria-label={tr('editor.cues.memoryPrev')}
          onClick={() => onMemoryStep(-1)}
          className={STEP}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory"
          aria-label={tr('editor.cues.addCall')}
          onClick={onMemory}
          className="press flex h-7 items-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 text-xs font-medium text-fg hover:bg-[var(--color-hover)]"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {tr('editor.cues.selectedCall')}
        </button>
        <button
          type="button"
          data-testid="cues-memory-next"
          aria-label={tr('editor.cues.memoryNext')}
          onClick={() => onMemoryStep(1)}
          className={STEP}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-remove"
          aria-label={tr('editor.cues.deleteCall')}
          aria-disabled={!canRemoveMemory}
          onClick={() => {
            if (canRemoveMemory) onMemoryRemove()
          }}
          className={`${STEP} aria-disabled:opacity-40`}
        >
          <Tooltip label={tr('editor.cues.deleteCall')} />
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {gridControls && (
        <div data-testid="cues-deck-grid" className="flex items-center gap-2">
          <DeckDivider />
          {gridControls}
        </div>
      )}
      {onClearAll && <DeckDivider />}
      {onClearAll && (
        <button
          type="button"
          data-testid="cues-clear-all"
          aria-label={tr('editor.cues.clearAll')}
          disabled={!canClearAll}
          onClick={onClearAll}
          className={`${STEP} disabled:pointer-events-none disabled:opacity-40`}
        >
          <Tooltip label={tr('editor.cues.clearAll')} />
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function DeckDivider(): React.JSX.Element {
  return (
    <span
      data-testid="cues-deck-divider"
      aria-hidden="true"
      className="h-5 w-px shrink-0 bg-[var(--color-line)]"
    />
  )
}

export function CueMoves({
  jumpBars,
  quantize,
  barQuantize = true,
  onJumpBars,
  onQuantize,
  onDone,
}: {
  jumpBars: CueJumpBars
  quantize: CueQuantize
  barQuantize?: boolean
  onJumpBars: (bars: CueJumpBars) => void
  onQuantize: (unit: CueQuantize) => void
  onDone?: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div data-testid="cues-moves" className="flex shrink-0 items-center gap-3">
      <div className="flex items-center gap-1 text-xs">
        <span className="text-fg-dim">{tr('editor.cues.jump')}</span>
        <Select
          testid="cues-jump"
          bare
          compact
          portal
          onClosed={onDone}
          label={tr('editor.cues.jump')}
          value={String(jumpBars)}
          onChange={(value) => {
            const bars = CUE_JUMP_BARS.find((b) => String(b) === value)
            if (bars) onJumpBars(bars)
          }}
          options={CUE_JUMP_BARS.map((b) => ({
            value: String(b),
            label: tr('editor.cues.jumpBars', { count: b }),
          }))}
        />
      </div>
      <div data-testid="cues-quantize-group" className="flex items-center gap-1 text-xs">
        <span aria-hidden="true" className="font-semibold text-fg-dim">
          Q
        </span>
        <Select
          testid="cues-quantize"
          bare
          compact
          portal
          onClosed={onDone}
          label={tr('editor.cues.quantize')}
          value={quantize}
          onChange={(value) => {
            const unit = CUE_QUANTIZE.find((u) => u === value)
            if (unit) onQuantize(unit)
          }}
          options={CUE_QUANTIZE.map((u) => ({
            value: u,
            label: u === 'bar' ? tr('editor.cues.quantizeBar') : tr('editor.cues.quantizeBeat'),
            disabled: u === 'bar' && !barQuantize,
          }))}
        />
      </div>
    </div>
  )
}
