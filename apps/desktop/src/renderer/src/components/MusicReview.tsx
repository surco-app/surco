import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type {
  MusicReview as Review,
  ReviewFilter,
  ReviewSpellingGroup,
} from '../hooks/useMusicReview'
import { SAFE_KINDS } from '../lib/musicSpelling'
import { ModalShell } from './ModalShell'

const BTN = 'press rounded-md px-2.5 py-1 text-xs outline-none disabled:opacity-40'
export const PRIMARY = `${BTN} bg-[var(--color-accent)] text-[var(--color-on-accent)]`
export const GHOST = `${BTN} text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg`

export function Dot({ safe }: { safe: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      role="img"
      aria-label={t(safe ? 'musicReview.safe' : 'musicReview.review')}
      className={`h-2 w-2 shrink-0 rounded-full ${safe ? 'bg-[var(--color-good)]' : 'bg-[var(--color-warn)]'}`}
    />
  )
}

export function fieldsLabel(t: TFunction, group: ReviewSpellingGroup): string {
  return group.fields.length > 1
    ? t('musicReview.bothArtists')
    : t(`musicReview.field.${group.fields[0]}`)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Captured and prevented: the app's own Escape handler is registered first and
      // skips a handled press, so only the sheet closes.
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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

function Confirm({
  review,
  busy,
  onCancel,
}: {
  review: Review
  busy: boolean
  onCancel: () => void
}) {
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
      {duplicates > 0 && <p className="text-xs text-fg-dim">{t('musicReview.removedNoUndo')}</p>}
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
          disabled={busy}
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

const LIBRARIES = [
  ['rekordbox', 'rekordbox'],
  ['engine', 'Engine DJ'],
  ['traktor', 'Traktor'],
] as const

function Done({
  review,
  busy,
  onContinue,
}: {
  review: Review
  busy: boolean
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const continueRef = useRef<HTMLButtonElement>(null)
  const run = review.lastRun
  if (!run) return null
  const undone = run.undoFailures !== undefined
  const removed = run.removed.filter((r) => r.outcome === 'removed').length
  const keptForLibrary = run.replaced.filter((r) => r.keptForLibrary).length
  const trashed = run.replaced.filter((r) => r.fileTrashed).length
  const libraryLines = LIBRARIES.flatMap(([library, name]) => {
    const count = (o: string) => run.replaced.filter((r) => r[library] === o).length
    const held = library === 'traktor' ? 0 : count('replaced')
    return [
      ...(held ? [t('musicReview.done.stillInCollection', { count: held, library: name })] : []),
      ...(count('skipped') ? [t('musicReview.done.librarySkipped', { library: name })] : []),
      ...(count('failed') ? [t('musicReview.done.libraryReplaceFailed', { library: name })] : []),
    ]
  })
  const replacedIn = LIBRARIES.map(([library, name]) => ({
    name,
    count: run.replaced.filter((r) => r[library] === 'replaced' || r[library] === 'repointed')
      .length,
  })).filter((l) => l.count > 0)
  const failedRemovals = run.removed.filter(
    (r) => r.outcome === 'playlist-failed' || r.outcome === 'failed' || r.outcome === 'mismatch',
  ).length
  const updated = run.outcomes.filter((o) => o.music.includes('set')).length + removed
  const musicOnly = run.outcomes.filter(
    (o) => o.music.includes('set') && (o.file === 'unchanged' || o.file === 'missing'),
  ).length
  // Only a backup brings a file back; without one, setting Music back alone would leave
  // it saying one thing and the file another.
  const undoable = run.outcomes.some(
    (o) => o.backupId !== undefined || (o.file !== 'written' && o.music.includes('set')),
  )
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
      {replacedIn.map((l) => (
        <p key={l.name} data-testid="music-review-done-replaced" className="text-fg-dim">
          {t('musicReview.done.replacedIn', { count: l.count, library: l.name })}
        </p>
      ))}
      {libraryLines.map((line) => (
        <p key={line} data-testid="music-review-done-library" className="text-fg-dim">
          {line}
        </p>
      ))}
      {run.librariesUntouched && (
        <p className="text-[var(--color-danger)]">{t('musicReview.done.librariesUntouched')}</p>
      )}
      {trashed > 0 && (
        <p className="text-fg-dim">{t('musicReview.done.trashed', { count: trashed })}</p>
      )}
      {keptForLibrary > 0 && (
        <p className="text-fg-dim">
          {t('musicReview.done.keptForLibrary', { count: keptForLibrary })}
        </p>
      )}
      {removed > 0 && <p className="text-fg-dim">{t('musicReview.removedNoUndo')}</p>}
      {!undone && run.after !== null && (
        <p className="text-fg-dim tabular-nums">
          {t('musicReview.done.left', { count: run.after })}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        {undoable && (
          <button
            type="button"
            data-testid="music-review-undo"
            className={GHOST}
            disabled={busy}
            onClick={() => void review.undo()}
          >
            {t('musicReview.done.undo')}
          </button>
        )}
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

const trackCount = (g: ReviewSpellingGroup) =>
  new Set(g.variants.flatMap((v) => v.persistentIds)).size

function Row({
  selected,
  staged,
  safe,
  name,
  detail,
  count,
  onSelect,
}: {
  selected: boolean
  staged: boolean
  safe: boolean
  name: string
  detail: string
  count?: number
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="option"
      data-testid="music-review-row"
      data-staged={staged || undefined}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect()
      }}
      className={`flex min-w-0 cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] ${selected ? 'bg-[var(--color-row-selected)] text-[var(--color-on-row-selected)]' : 'hover:bg-[var(--color-hover)]'} ${staged ? 'opacity-60' : ''}`}
    >
      <Dot safe={safe} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm">{name}</span>
        <span className="truncate text-xs text-fg-faint">
          {detail}
          {staged && ` · ${t('musicReview.inTray')}`}
        </span>
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-fg-faint">
          {t('musicReview.tracks', { count })}
        </span>
      )}
    </div>
  )
}

// `busy` is a conversion running elsewhere in the app: it writes the same files and the
// same library databases, so nothing here may start a write until it ends.
export function MusicReview({
  review,
  selectedKey,
  onSelect,
  onClose,
  busy = false,
}: {
  review: Review
  selectedKey: string | null
  onSelect: (key: string) => void
  onClose: () => void
  busy?: boolean
}) {
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
        <div
          role="listbox"
          aria-label={t('musicReview.title')}
          className="grid gap-0.5"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const options = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
            const keys = [
              ...(showSpelling ? review.spelling.map((g) => g.key) : []),
              ...(showDuplicates ? review.duplicates.map((c) => c.group.key) : []),
            ]
            const at = keys.indexOf(selectedKey ?? '')
            const next = Math.min(
              Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0),
              keys.length - 1,
            )
            if (next < 0) return
            onSelect(keys[next])
            options[next]?.focus()
          }}
        >
          {showSpelling &&
            review.spelling.map((g) => (
              <Row
                key={g.key}
                selected={g.key === selectedKey}
                staged={review.staged.has(g.key)}
                safe={SAFE_KINDS.has(g.kind)}
                name={review.choice(g.key) ?? g.variants[0].value}
                detail={`${fieldsLabel(t, g)} · ${t(`musicReview.kind.${g.kind}`)}`}
                count={trackCount(g)}
                onSelect={() => onSelect(g.key)}
              />
            ))}
          {showDuplicates &&
            review.duplicates.map(({ group, entries }) => (
              <Row
                key={group.key}
                selected={group.key === selectedKey}
                staged={review.staged.has(group.key)}
                safe={group.kind !== 'version'}
                name={`${entries[0]?.artist} · ${entries[0]?.title}`}
                detail={
                  group.kind === 'version'
                    ? t('musicReview.kind.version')
                    : t('musicReview.kind.duplicate', { count: entries.length })
                }
                onSelect={() => onSelect(group.key)}
              />
            ))}
        </div>
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
              disabled={busy || review.staged.size === 0}
              onClick={() => setConfirming(true)}
            >
              {t('musicReview.tray.apply')}
            </button>
          </>
        )}
      </div>
      {confirming && <Confirm review={review} busy={busy} onCancel={() => setConfirming(false)} />}
      {(review.status === 'done' || review.status === 'ready') &&
        review.lastRun &&
        doneSeen !== review.lastRun && (
          <Done review={review} busy={busy} onContinue={() => setDoneSeen(review.lastRun)} />
        )}
    </div>
  )
}
