import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { CUE_JUMP_BARS, type CueJumpBars } from '../../../shared/cueJump'
import { HOT_KINDS } from '../../../shared/cueRules'
import { hotCueColor, PAD_LETTER_COLOR } from '../../../shared/rekordboxCueColors'
import { cueLetter } from '../lib/rowCues'

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
  jumpBars,
  onPad,
  onMemory,
  onMemoryStep,
  onMemoryRemove,
  onJumpBars,
}: {
  cues: DeckCue[]
  selected: string | null
  jumpBars: CueJumpBars
  onPad: (kind: number) => void
  onMemory: () => void
  onMemoryStep: (dir: 1 | -1) => void
  onMemoryRemove: () => void
  onJumpBars: (bars: CueJumpBars) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const at = CUE_JUMP_BARS.indexOf(jumpBars)
  return (
    <div data-testid="cues-deck" className="flex flex-wrap items-center gap-x-5 gap-y-3 pb-4">
      <div className="flex items-center gap-1.5">
        {HOT_KINDS.map((kind, i) => {
          const cue = cues.find((c) => c.kind === kind)
          const letter = cueLetter(kind)
          const isSelected = cue !== undefined && cue.key === selected
          return (
            <button
              key={kind}
              type="button"
              data-testid={`cues-pad-${letter}`}
              data-set={cue ? 'true' : 'false'}
              aria-label={tr('editor.cues.selectedHot', { letter })}
              aria-pressed={isSelected}
              onClick={() => onPad(kind)}
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
          onClick={onMemoryRemove}
          className={GHOST}
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
