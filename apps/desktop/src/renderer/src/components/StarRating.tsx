import { Star } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// A 0–5 star picker. Clicking a star sets that many; clicking the highest filled
// star again clears the rating (back to none). Value is the "1"–"5"/"" string the
// rest of the app stores; the write path turns it into the Traktor POPM byte.
export function StarRating({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const stars = Number(value) || 0
  // While the pointer rests on a star, fill up to it as a live preview of what a click
  // would set; the committed rating drives aria-pressed so assistive tech reads the
  // real value, not the hover.
  const [hovered, setHovered] = useState(0)
  const shown = hovered || stars
  return (
    // The leave handler only clears the visual hover preview; the stars are the
    // controls. Resetting per-button would misfire as the pointer crosses between them.
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-preview reset, not a control
    <span
      data-testid="star-rating"
      className="flex items-center gap-0.5"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown
        return (
          <button
            key={n}
            type="button"
            data-testid={`star-${n}`}
            aria-pressed={n <= stars}
            aria-label={tr('editor.ratingStars', { count: n })}
            onClick={() => onChange(n === stars ? '' : String(n))}
            onMouseEnter={() => setHovered(n)}
            className={`press ${filled ? 'text-warn' : 'text-fg-faint'}`}
          >
            <Star
              className="h-4 w-4"
              fill={filled ? 'currentColor' : 'none'}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </span>
  )
}
