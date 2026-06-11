import { Star } from 'lucide-react'
import type React from 'react'
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
  return (
    <span data-testid="star-rating" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= stars
        return (
          <button
            key={n}
            type="button"
            data-testid={`star-${n}`}
            aria-pressed={filled}
            aria-label={tr('editor.ratingStars', { count: n })}
            onClick={() => onChange(n === stars ? '' : String(n))}
            className={`press ${filled ? 'text-warn' : 'text-fg-faint hover:text-fg-dim'}`}
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
