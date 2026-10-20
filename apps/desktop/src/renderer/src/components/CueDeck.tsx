import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor, PAD_LETTER_COLOR } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'
import { CuePalette } from './CuePalette'

export interface DeckCue {
  key: string
  kind: number
  color: number | null
}

const BUTTON =
  'press inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--color-hover)]'
const GHOST =
  'press inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'
const STEP = 'press px-2 py-1 hover:bg-[var(--color-hover)] disabled:opacity-40'

export function CueDeck({
  cues,
  selected,
  locked,
  jumpBars,
  onPad,
  onRecolour,
  onMemory,
  onMemoryStep,
  onMemoryRemove,
  canRemoveMemory,
  onJumpBars,
}: {
  cues: DeckCue[]
  selected: string | null
  locked: string[]
  jumpBars: CueJumpBars
  onPad: (kind: number) => void
  onRecolour: (key: string, color: number) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onMemoryRemove: () => void
  canRemoveMemory: boolean
  onJumpBars: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const at = CUE_JUMP_BARS.indexOf(jumpBars)
  const [colouring, setColouring] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (colouring === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setColouring(null)
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
  }, [colouring])
  return (
    <div data-testid="cues-deck" className="flex flex-wrap items-center gap-x-5 gap-y-3 pb-4">
      <div className="flex items-center gap-1.5">
        {HOT_KINDS.map((kind, i) => {
          const cue = cues.find((c) => c.kind === kind)
          const letter = cueLetter(kind)
          const isSelected = cue !== undefined && cue.key === selected
          return (
            <span key={kind} className="relative">
              <button
                type="button"
                data-testid={`cues-pad-${letter}`}
                data-set={cue ? 'true' : 'false'}
                aria-label={tr('editor.cues.selectedHot', { letter })}
                aria-pressed={isSelected}
                onClick={() => onPad(kind)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (cue && !locked.includes(cue.key)) setColouring(cue.key)
                }}
                style={
                  cue
                    ? { backgroundColor: hotCueColor(cue.color), color: PAD_LETTER_COLOR }
                    : undefined
                }
                className={`press relative flex h-8 w-9 items-center justify-center rounded-[5px] text-sm font-bold ${
                  cue
                    ? ''
                    : 'border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg-faint'
                } ${isSelected ? 'outline outline-2 outline-offset-2 outline-[var(--color-fg)]' : ''}`}
              >
                {letter}
                <span
                  aria-hidden="true"
                  className="absolute -bottom-4 font-mono text-[10px] font-normal text-fg-faint"
                >
                  {i + 1}
                </span>
              </button>
              {cue && colouring === cue.key && (
                <div
                  ref={popoverRef}
                  data-testid="cues-pad-colours"
                  className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-2.5 shadow-[var(--shadow-float)]"
                >
                  <CuePalette
                    value={cue.color}
                    onPick={(color) => {
                      onRecolour(cue.key, color)
                      setColouring(null)
                    }}
                    label={(index) => tr('editor.cues.colour', { index })}
                  />
                </div>
              )}
            </span>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" data-testid="cues-memory" onClick={onMemory} className={BUTTON}>
          {tr('editor.cues.memory')}
          <kbd className="font-mono text-[11px] font-normal text-fg-faint">M</kbd>
        </button>
        <button
          type="button"
          data-testid="cues-memory-prev"
          aria-label={tr('editor.cues.memoryPrev')}
          onClick={() => onMemoryStep(-1)}
          className={GHOST}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-next"
          aria-label={tr('editor.cues.memoryNext')}
          onClick={() => onMemoryStep(1)}
          className={GHOST}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cues-memory-remove"
          aria-label={tr('editor.cues.memoryRemove')}
          disabled={!canRemoveMemory}
          onClick={onMemoryRemove}
          className={`${GHOST} disabled:opacity-40`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-dim">{tr('editor.cues.jump')}</span>
        <div className="flex items-center overflow-hidden rounded-md border border-[var(--color-line-strong)]">
          <button
            type="button"
            data-testid="cues-jump-less"
            aria-label={tr('editor.cues.jumpLess')}
            disabled={at <= 0}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at - 1])}
            className={STEP}
          >
            ‹
          </button>
          <span
            data-testid="cues-jump-value"
            className="min-w-24 border-x border-[var(--color-line-strong)] px-2 py-1 text-center font-mono"
          >
            {tr('editor.cues.jumpBars', { count: jumpBars })}
          </span>
          <button
            type="button"
            data-testid="cues-jump-more"
            aria-label={tr('editor.cues.jumpMore')}
            disabled={at >= CUE_JUMP_BARS.length - 1}
            onClick={() => onJumpBars(CUE_JUMP_BARS[at + 1])}
            className={STEP}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
