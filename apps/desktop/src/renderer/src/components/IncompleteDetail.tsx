import { useTranslation } from 'react-i18next'
import {
  type IncompleteCard,
  incompleteKey,
  type MusicReview as Review,
} from '../hooks/useMusicReview'
import { missingLabel } from './MusicReview'
import { GroupFooter, Header } from './MusicReviewDetail'

const INPUT =
  'w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]/30 px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-fg-faint hover:border-[var(--color-line-strong)] hover:bg-[var(--color-hover)]/50 focus:border-[var(--color-accent)] focus:bg-[var(--color-field)]'
const HINT = 'mt-1 block text-[11.5px] text-fg-faint'

export function IncompleteDetail({ card, review }: { card: IncompleteCard; review: Review }) {
  const { t } = useTranslation()
  const key = incompleteKey(card.id)
  const busy = review.status === 'applying'
  const staged = review.staged.has(key)
  const fillable = card.fields.some((f) => review.fillValue(card.id, f.field).trim())
  return (
    <>
      <div data-testid="incomplete-detail" className="min-h-0 flex-1 overflow-y-auto p-7">
        <Header name={card.name} detail={missingLabel(t, card)} />
        <div className="grid gap-4">
          {card.fields.map(({ field, proposal }) => {
            const value = review.fillValue(card.id, field)
            const others = review.incomplete.filter(
              (o) => o.id !== card.id && o.fields.some((x) => x.field === field),
            )
            const label = t(`musicReview.field.${field}`)
            return (
              <label key={field} className="grid gap-1.5">
                <span className="text-xs font-medium text-fg-dim">{label}</span>
                <input
                  data-testid="incomplete-value"
                  className={INPUT}
                  value={value}
                  disabled={busy}
                  placeholder={t('musicReview.incomplete.empty')}
                  onChange={(e) => review.setFillValue(card.id, field, e.target.value)}
                />
                <span className={HINT}>
                  {t(`musicReview.incomplete.source.${proposal?.source ?? 'none'}`)}
                  {value.trim() && others.length > 0 && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        data-testid={`incomplete-use-others-${field}`}
                        disabled={busy}
                        className="text-[var(--color-accent)] hover:underline"
                        onClick={() => {
                          for (const o of others) review.setFillValue(o.id, field, value)
                        }}
                      >
                        {t('musicReview.incomplete.useForOthers', { count: others.length })}
                      </button>
                    </>
                  )}
                </span>
              </label>
            )
          })}
        </div>
        <p className="mt-6 text-xs text-fg-faint">{t('musicReview.incomplete.note')}</p>
      </div>
      <GroupFooter
        testid="incomplete-stage"
        label={staged ? t('musicReview.staged') : t('musicReview.incomplete.stage')}
        disabled={busy || (!staged && !fillable)}
        onStage={() => review.toggleStaged(key)}
        menuLabel={t('musicReview.ignore')}
        menuDisabled={busy}
        onMenu={() => review.ignore(key)}
      />
    </>
  )
}
