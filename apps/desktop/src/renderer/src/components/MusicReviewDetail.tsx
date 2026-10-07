import { useTranslation } from 'react-i18next'
import type {
  DuplicateCard,
  MusicReview as Review,
  ReviewSpellingGroup,
} from '../hooks/useMusicReview'
import { fieldsLabel, GHOST, PRIMARY } from './MusicReview'

export interface ReviewSync {
  rekordbox: boolean
  engineDj: boolean
  traktor: boolean
}

const HEADING = 'text-xs font-semibold text-fg-dim'

const clock = (sec?: number) =>
  sec === undefined ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

function Header({
  name,
  detail,
  children,
}: {
  name: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <header className="flex min-w-0 flex-wrap items-start gap-3">
      <div className="grid min-w-0 gap-0.5">
        <h2 className="truncate text-base font-semibold">{name}</h2>
        <p className="truncate text-xs text-fg-faint">{detail}</p>
      </div>
      <div className="ml-auto flex shrink-0 gap-1.5">{children}</div>
    </header>
  )
}

function SpellingDetail({ group, review }: { group: ReviewSpellingGroup; review: Review }) {
  const { t } = useTranslation()
  const busy = review.status === 'applying'
  const chosen = review.choice(group.key)
  const staged = review.staged.has(group.key)
  const name = chosen ?? group.variants[0].value
  return (
    <>
      <Header
        name={name}
        detail={`${fieldsLabel(t, group)} · ${t(`musicReview.kind.${group.kind}`)}`}
      >
        <button
          type="button"
          data-testid="music-review-ignore"
          className={GHOST}
          disabled={busy}
          onClick={() => review.ignore(group.key)}
        >
          {t(group.kind === 'typo' ? 'musicReview.notSame' : 'musicReview.ignore')}
        </button>
        <button
          type="button"
          data-testid="music-review-stage"
          className={PRIMARY}
          disabled={busy || chosen === null}
          onClick={() => review.toggleStaged(group.key)}
        >
          {t(staged ? 'musicReview.staged' : 'musicReview.unify')}
        </button>
      </Header>
      <section className="grid gap-2">
        <h3 className={HEADING}>{t('musicReview.detail.options')}</h3>
        <div
          role="radiogroup"
          aria-label={`${fieldsLabel(t, group)} ${name}`}
          className="grid gap-0.5"
        >
          {group.variants.map((v) => (
            <label
              key={v.value}
              data-testid="music-review-option"
              className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--color-hover)]"
            >
              <input
                type="radio"
                name={group.key}
                checked={chosen === v.value}
                disabled={busy}
                onChange={() => review.choose(group.key, v.value)}
                className="accent-[var(--color-accent)]"
              />
              <span className="truncate text-sm">{v.value}</span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-faint">
                {t('musicReview.tracks', { count: v.persistentIds.length })}
              </span>
            </label>
          ))}
        </div>
        {chosen === null && <p className="text-xs text-fg-faint">{t('musicReview.tie')}</p>}
      </section>
    </>
  )
}

function DuplicateDetail({ card, review }: { card: DuplicateCard; review: Review }) {
  const { t } = useTranslation()
  const { group, entries, formats } = card
  const busy = review.status === 'applying'
  const keep = review.choice(group.key)
  const staged = review.staged.has(group.key)
  const version = group.kind === 'version'
  const first = entries[0]
  return (
    <>
      <Header
        name={`${first?.artist} · ${first?.title}`}
        detail={
          version
            ? t('musicReview.kind.version')
            : t('musicReview.kind.duplicate', { count: entries.length })
        }
      >
        <button
          type="button"
          data-testid="music-review-ignore"
          className={GHOST}
          disabled={busy}
          onClick={() => review.ignore(group.key)}
        >
          {t(version ? 'musicReview.different' : 'musicReview.ignore')}
        </button>
        <button
          type="button"
          data-testid="music-review-stage"
          className={version ? GHOST : PRIMARY}
          disabled={busy}
          onClick={() => review.toggleStaged(group.key)}
        >
          {staged
            ? t('musicReview.staged')
            : t('musicReview.remove', { count: entries.length - 1 })}
        </button>
      </Header>
      <div
        role="radiogroup"
        aria-label={`${first?.artist} · ${first?.title}`}
        className="grid gap-0.5"
      >
        {entries.map((e) => (
          <label
            key={e.persistentId}
            data-testid="music-review-copy"
            className={`flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1 ${keep === e.persistentId ? 'bg-[var(--color-accent-soft)]' : ''}`}
          >
            <input
              type="radio"
              name={group.key}
              checked={keep === e.persistentId}
              disabled={busy}
              onChange={() => review.choose(group.key, e.persistentId)}
              className="accent-[var(--color-accent)]"
            />
            <span className="grid min-w-0">
              <span className="truncate text-sm">{e.title}</span>
              <span className="truncate text-xs text-fg-faint tabular-nums">
                {e.artist} · {clock(e.durationSec)}
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] text-fg-dim">
              {formats[e.persistentId] ?? ''}
            </span>
            {keep === e.persistentId && (
              <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)]">
                {t('musicReview.keeps')}
              </span>
            )}
          </label>
        ))}
      </div>
    </>
  )
}

export function MusicReviewDetail({
  review,
  selectedKey,
}: {
  review: Review
  selectedKey: string | null
  sync: ReviewSync
}) {
  const spelling = review.spelling.find((g) => g.key === selectedKey)
  const duplicate = review.duplicates.find((c) => c.group.key === selectedKey)
  return (
    <section data-testid="music-review-detail" className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-3xl gap-6 p-8">
        {spelling && <SpellingDetail group={spelling} review={review} />}
        {duplicate && <DuplicateDetail card={duplicate} review={review} />}
      </div>
    </section>
  )
}
