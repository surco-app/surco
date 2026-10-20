import { Check } from 'lucide-react'
import type React from 'react'
import { HOT_CUE_PICKER, hotCueColor } from '../../../shared/rekordboxCueColors'

export function CuePalette({
  value,
  onPick,
  label,
}: {
  value: number | null
  onPick: (index: number) => void
  label: (index: number) => string
}): React.JSX.Element {
  return (
    <div data-testid="cue-palette" className="grid w-max shrink-0 grid-cols-4 gap-1.5">
      {HOT_CUE_PICKER.map((index) => (
        <button
          key={index}
          type="button"
          data-testid={`cue-palette-${index}`}
          aria-label={label(index)}
          aria-pressed={value === index}
          onClick={() => onPick(index)}
          style={{ backgroundColor: hotCueColor(index) }}
          className={`press flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] ${
            value === index
              ? 'ring-2 ring-[var(--color-fg)] ring-offset-1 ring-offset-[var(--color-panel)]'
              : ''
          }`}
        >
          {value === index && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}
