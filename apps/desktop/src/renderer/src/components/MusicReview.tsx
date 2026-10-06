import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DuplicateCard, MusicReview as Review, ReviewFilter } from '../hooks/useMusicReview'
import { SAFE_KINDS, type SpellingGroup } from '../lib/musicSpelling'
import { ModalShell } from './ModalShell'

const BTN = 'press rounded-md px-2.5 py-1 text-xs outline-none disabled:opacity-40'
const PRIMARY = `${BTN} bg-[var(--color-accent)] text-[var(--color-on-accent)]`
const GHOST = `${BTN} text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg`
const CARD = 'grid gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-3'

const clock = (sec?: number) =>
  sec === undefined ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

function Dot({ safe }: { safe: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      role="img"
      aria-label={t(safe ? 'musicReview.safe' : 'musicReview.review')}
      className={`h-2 w-2 shrink-0 rounded-full ${safe ? 'bg-[var(--color-good)]' : 'bg-[var(--color-warn)]'}`}
    />
  )
}

function SpellingCard({ group, review }: { group: SpellingGroup; review: Review }) {
  const { t } = useTranslation()
  const busy = review.status === 'applying'
  const chosen = review.choice(group.key)
  const staged = review.staged.has(group.key)
  return (
    <article data-testid="music-review-group" className={`${CARD} ${staged ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Dot safe={SAFE_KINDS.has(group.kind)} />
        <b className="truncate text-sm">{chosen ?? group.variants[0].value}</b>
        <span className="truncate text-xs text-fg-faint">
          {t(`musicReview.field.${group.field}`)} · {t(`musicReview.kind.${group.kind}`)}
        </span>
        <div className="ml-auto flex shrink-0 gap-1.5">
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
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={`${t(`musicReview.field.${group.field}`)} ${chosen ?? group.variants[0].value}`}
        className="grid gap-0.5"
      >
        {group.variants.map((v) => (
          <label
            key={v.value}
            className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-[var(--color-hover)]"
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
    </article>
  )
}

function DuplicateCardView({ card, review }: { card: DuplicateCard; review: Review }) {
  const { t } = useTranslation()
  const { group, entries, formats } = card
  const busy = review.status === 'applying'
  const keep = review.choice(group.key)
  const staged = review.staged.has(group.key)
  const version = group.kind === 'version'
  const first = entries[0]
  return (
    <article
      data-testid="music-review-duplicate"
      className={`${CARD} ${staged ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Dot safe={!version} />
        <b className="truncate text-sm">
          {first?.artist} · {first?.title}
        </b>
        <span className="shrink-0 text-xs text-fg-faint">
          {version
            ? t('musicReview.kind.version')
            : t('musicReview.kind.duplicate', { count: entries.length })}
        </span>
        <div className="ml-auto flex shrink-0 gap-1.5">
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
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label={`${first?.artist} · ${first?.title}`}
        className="grid gap-0.5"
      >
        {entries.map((e) => (
          <label
            key={e.persistentId}
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
    </article>
  )
}

function Sheet({
  testId,
  titleId,
  onClose,
  primaryRef,
  children,
}: {
  testId: string
  titleId: string
  onClose: () => void
  primaryRef: React.RefObject<HTMLButtonElement | null>
  children: React.ReactNode
}) {
  useEffect(() => {
    primaryRef.current?.focus()
  }, [primaryRef])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <ModalShell
      onClose={onClose}
      backdropTestId={`${testId}-backdrop`}
      dialogTestId={testId}
      labelledBy={titleId}
      className="grid w-full max-w-sm gap-3 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-4"
    >
      {children}
    </ModalShell>
  )
}

function Confirm({ review, onCancel }: { review: Review; onCancel: () => void }) {
  const { t } = useTranslation()
  const { tracks, byField, duplicates } = review.summary
  const applyRef = useRef<HTMLButtonElement>(null)
  return (
    <Sheet
      testId="music-review-confirm"
      titleId="music-review-confirm-title"
      onClose={onCancel}
      primaryRef={applyRef}
    >
      <h3 id="music-review-confirm-title" className="text-sm font-semibold">
        {t('musicReview.confirm.title', { count: tracks + duplicates })}
      </h3>
      <dl className="grid gap-1 text-sm">
        {Object.entries(byField).map(([field, n]) => (
          <div
            key={field}
            className="flex justify-between border-b border-[var(--color-line)] py-1"
          >
            <dt>{t(`musicReview.field.${field}`)}</dt>
            <dd className="tabular-nums">{n}</dd>
          </div>
        ))}
        {duplicates > 0 && (
          <div className="flex justify-between border-b border-[var(--color-line)] py-1">
            <dt>{t('musicReview.confirm.removed')}</dt>
            <dd className="tabular-nums">{duplicates}</dd>
          </div>
        )}
      </dl>
      {duplicates > 0 && (
        <p className="text-xs text-fg-dim">
          {t('musicReview.confirm.playlists')}. {t('musicReview.confirm.trash')}.
        </p>
      )}
      <p className="text-xs text-fg-dim">{t('musicReview.confirm.untouched')}</p>
      <p className="text-xs text-fg-dim">{t('musicReview.confirm.libraries')}</p>
      <label className="flex items-center gap-2 text-xs text-fg-dim">
        <input type="checkbox" checked disabled readOnly /> {t('musicReview.confirm.backup')}
      </label>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          data-testid="music-review-confirm-cancel"
          className={GHOST}
          onClick={onCancel}
        >
          {t('musicReview.confirm.cancel')}
        </button>
        <button
          type="button"
          data-testid="music-review-confirm-apply"
          ref={applyRef}
          className={PRIMARY}
          onClick={() => {
            onCancel()
            void review.apply()
          }}
        >
          {t('musicReview.confirm.apply')}
        </button>
      </div>
    </Sheet>
  )
}

function Done({ review, onContinue }: { review: Review; onContinue: () => void }) {
  const { t } = useTranslation()
  const continueRef = useRef<HTMLButtonElement>(null)
  const run = review.lastRun
  if (!run) return null
  const undone = run.undoFailures !== undefined
  const removed = run.removed.filter((r) => r.outcome === 'removed').length
  const failedRemovals = run.removed.filter(
    (r) => r.outcome === 'playlist-failed' || r.outcome === 'failed' || r.outcome === 'mismatch',
  ).length
  const updated = run.outcomes.filter((o) => o.music.includes('set')).length + removed
  const musicOnly = run.outcomes.filter(
    (o) => o.music.includes('set') && (o.file === 'unchanged' || o.file === 'missing'),
  ).length
  const failed =
    run.outcomes.filter(
      (o) => o.file === 'failed' || o.music.some((m) => m === 'failed' || m === 'mismatch'),
    ).length + failedRemovals
  return (
    <Sheet
      testId="music-review-done"
      titleId="music-review-done-title"
      onClose={onContinue}
      primaryRef={continueRef}
    >
      <h3 id="music-review-done-title" className="text-sm font-semibold">
        {t('musicReview.done.title')}
      </h3>
      {undone ? (
        <p className="text-[var(--color-danger)]">
          {t('musicReview.done.undoFailed', { count: run.undoFailures })}
        </p>
      ) : (
        <>
          <p>{t('musicReview.done.updated', { count: updated })}</p>
          {musicOnly > 0 && (
            <p className="text-fg-dim">{t('musicReview.done.musicOnly', { count: musicOnly })}</p>
          )}
          {failed > 0 && (
            <p className="text-[var(--color-danger)]">
              {t('musicReview.done.failed', { count: failed })}
            </p>
          )}
          {run.applyError !== undefined && (
            <p className="text-[var(--color-danger)]">{t('musicReview.done.applyError')}</p>
          )}
        </>
      )}
      {run.librarySync === 'failed' && (
        <p className="text-[var(--color-danger)]">{t('musicReview.done.libraryFailed')}</p>
      )}
      {!undone && run.after !== null && (
        <p className="text-fg-dim tabular-nums">
          {t('musicReview.done.left', { count: run.after })}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          data-testid="music-review-undo"
          className={GHOST}
          onClick={() => void review.undo()}
        >
          {t('musicReview.done.undo')}
        </button>
        <button
          type="button"
          data-testid="music-review-continue"
          ref={continueRef}
          className={PRIMARY}
          onClick={onContinue}
        >
          {t('musicReview.done.continue')}
        </button>
      </div>
    </Sheet>
  )
}

const FILTERS: ReviewFilter[] = ['all', 'spelling', 'duplicates']

export function MusicReview({ review, onClose }: { review: Review; onClose: () => void }) {
  const { t } = useTranslation()
  const applying = review.status === 'applying'
  const [confirming, setConfirming] = useState(false)
  const [doneSeen, setDoneSeen] = useState<object | null>(null)
  const counts = {
    all: review.spelling.length + review.duplicates.length,
    spelling: review.spelling.length,
    duplicates: review.duplicates.length,
  }
  const showSpelling = review.filter !== 'duplicates'
  const showDuplicates = review.filter !== 'spelling'
  const pending = review.summary.tracks + review.summary.duplicates
  const nothing = review.status === 'ready' && counts.all === 0
  return (
    <div data-testid="music-review" className="relative flex min-h-0 flex-1 flex-col">
      <div className="grid gap-2.5 border-b border-[var(--color-line)] px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('musicReview.title')}</h2>
          <button
            type="button"
            data-testid="music-review-close"
            className={`${GHOST} ml-auto`}
            disabled={applying}
            onClick={onClose}
          >
            {t('musicReview.close')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              data-testid={`music-review-filter-${f}`}
              aria-pressed={review.filter === f}
              disabled={applying}
              onClick={() => review.setFilter(f)}
              className="press rounded-full border border-[var(--color-line-strong)] px-2.5 py-0.5 text-xs text-fg-dim outline-none disabled:opacity-40 aria-pressed:border-transparent aria-pressed:bg-[var(--color-accent-soft)] aria-pressed:text-fg"
            >
              {t(`musicReview.filter.${f}`)}{' '}
              <span className="tabular-nums text-fg-faint">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3 pb-24">
        {review.status === 'loading' && (
          <p
            data-testid="music-review-loading"
            aria-live="polite"
            className="text-xs text-fg-faint"
          >
            {t('musicReview.loading')}
          </p>
        )}
        {review.status === 'empty' && (
          <p data-testid="music-review-empty" className="text-xs text-fg-faint">
            {t('musicReview.empty')}
          </p>
        )}
        {review.status === 'error' && (
          <p data-testid="music-review-error" className="text-xs text-fg-faint">
            {t('musicReview.error')}
          </p>
        )}
        {nothing && (
          <p data-testid="music-review-clean" className="text-xs text-fg-faint">
            {t('musicReview.clean')}
          </p>
        )}
        {showSpelling &&
          review.spelling.map((g) => <SpellingCard key={g.key} group={g} review={review} />)}
        {showDuplicates &&
          review.duplicates.map((c) => (
            <DuplicateCardView key={c.group.key} card={c} review={review} />
          ))}
      </div>
      <div
        data-testid="music-review-tray"
        className="absolute right-3 bottom-3 left-3 flex items-center gap-2.5 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2.5"
      >
        {review.status === 'applying' ? (
          <>
            <span className="text-xs tabular-nums">
              {t('musicReview.applying', {
                done: review.progress?.done ?? 0,
                total: review.progress?.total ?? 0,
              })}
            </span>
            <button
              type="button"
              data-testid="music-review-stop"
              className={`${GHOST} ml-auto`}
              onClick={review.cancel}
            >
              {t('musicReview.stop')}
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate text-xs">
              {pending > 0
                ? t('musicReview.tray.count', { count: pending })
                : t('musicReview.tray.empty')}
            </span>
            <button
              type="button"
              data-testid="music-review-tray-apply"
              className={`${PRIMARY} ml-auto shrink-0`}
              disabled={review.staged.size === 0}
              onClick={() => setConfirming(true)}
            >
              {t('musicReview.tray.apply')}
            </button>
          </>
        )}
      </div>
      {confirming && <Confirm review={review} onCancel={() => setConfirming(false)} />}
      {(review.status === 'done' || review.status === 'ready') &&
        review.lastRun &&
        doneSeen !== review.lastRun && (
          <Done review={review} onContinue={() => setDoneSeen(review.lastRun)} />
        )}
    </div>
  )
}
