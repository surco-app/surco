import type { TFunction } from 'i18next'
import {
  ArrowDownUp,
  CaseSensitive,
  Copy as CopyIcon,
  List,
  ListChecks,
  ListMusic,
  type LucideIcon,
  SpellCheck,
  X,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DuplicateCard,
  MusicReview as Review,
  ReviewFilter,
  ReviewPhase,
  ReviewSpellingGroup,
} from '../hooks/useMusicReview'
import { INVISIBLE } from '../lib/musicSpelling'
import { DIALOG_BUTTON, DIALOG_CANCEL, DIALOG_OK, DIALOG_PANEL } from './ConfirmDialog'
import { FilterBar, FilterOption } from './FilterBar'
import {
  CoverPlaceholder,
  listRowClass,
  PILL_TEXT,
  ROW_DETAIL,
  ROW_TITLE,
  ROW_TRAILING,
  ToneBadge,
  TonePill,
} from './ListRow'
import { ModalShell } from './ModalShell'
import { SearchInput } from './SearchInput'
import { Select } from './Select'
import { PrimaryAction } from './Toolbar'
import { Tooltip } from './Tooltip'
import { TopProgressBar } from './TopProgressBar'

const OK = `${DIALOG_BUTTON} ${DIALOG_OK}`

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
      className={`grid gap-3 ${DIALOG_PANEL}`}
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
      <h3 id="music-review-confirm-title" className="text-base font-semibold">
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
      {missingLibraries(review).map((name) => (
        <p key={name} data-testid="music-review-confirm-missing" className="text-xs text-fg-dim">
          {t('musicReview.confirm.libraryMissing', { library: name })}
        </p>
      ))}
      <p className="text-xs text-fg-dim">{t('musicReview.confirm.backup')}</p>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          data-testid="music-review-confirm-cancel"
          className={DIALOG_CANCEL}
          onClick={onCancel}
        >
          {t('musicReview.confirm.cancel')}
        </button>
        <button
          type="button"
          data-testid="music-review-confirm-apply"
          ref={applyRef}
          className={OK}
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

const missingLibraries = (review: Review) =>
  LIBRARIES.filter(([library]) => {
    const status = review.libraries?.[library]
    return status?.enabled && !status.found
  }).map(([, name]) => name)

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
      <h3 id="music-review-done-title" className="text-base font-semibold">
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
      {(run.outcomes.some((o) => o.file === 'written') || run.replaced.length > 0) &&
        missingLibraries(review).map((name) => (
          <p key={name} data-testid="music-review-done-missing" className="text-fg-dim">
            {t('musicReview.done.libraryMissing', { library: name })}
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
            className={DIALOG_CANCEL}
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
          className={OK}
          onClick={onContinue}
        >
          {t('musicReview.done.continue')}
        </button>
      </div>
    </Sheet>
  )
}

const FILTERS: ReviewFilter[] = ['all', 'spelling', 'duplicates']
const FILTER_ICONS: Record<ReviewFilter, LucideIcon> = {
  all: List,
  spelling: SpellCheck,
  duplicates: CopyIcon,
}

export type ReviewSort = 'default' | 'tracks' | 'name'

const trackCount = (g: ReviewSpellingGroup) =>
  new Set(g.variants.flatMap((v) => v.persistentIds)).size

const nameOf = (review: Review, g: ReviewSpellingGroup) =>
  review.choice(g.key) ?? g.variants[0].value
const duplicateName = (c: DuplicateCard) => `${c.entries[0]?.artist} · ${c.entries[0]?.title}`

// A search ignores case, accents and the invisible characters the review exists to find.
const fold = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').replace(INVISIBLE, '').toLowerCase()

export function visibleGroups(
  review: Review,
  search: string,
  sort: ReviewSort,
): { spelling: ReviewSpellingGroup[]; duplicates: DuplicateCard[] } {
  const query = fold(search.trim())
  const hit = (texts: string[]) => !query || texts.some((text) => fold(text).includes(query))
  const spelling =
    review.filter === 'duplicates'
      ? []
      : review.spelling.filter((g) => hit([nameOf(review, g), ...g.variants.map((v) => v.value)]))
  const duplicates =
    review.filter === 'spelling'
      ? []
      : review.duplicates.filter((c) =>
          hit(c.entries.flatMap((e) => [e.artist, e.title, e.album ?? ''])),
        )
  if (sort === 'name')
    return {
      spelling: [...spelling].sort((a, b) => nameOf(review, a).localeCompare(nameOf(review, b))),
      duplicates: [...duplicates].sort((a, b) => duplicateName(a).localeCompare(duplicateName(b))),
    }
  if (sort === 'tracks')
    return {
      spelling: [...spelling].sort((a, b) => trackCount(b) - trackCount(a)),
      duplicates: [...duplicates].sort((a, b) => b.entries.length - a.entries.length),
    }
  return { spelling, duplicates }
}

export const visibleKeys = (review: Review, search: string, sort: ReviewSort) => {
  const { spelling, duplicates } = visibleGroups(review, search, sort)
  return [...spelling.map((g) => g.key), ...duplicates.map((c) => c.group.key)]
}

const RISKY_KINDS = new Set(['typo', 'version'])

function Row({
  selected,
  staged,
  kind,
  name,
  detail,
  count,
  onSelect,
}: {
  selected: boolean
  staged: boolean
  kind: ReviewSpellingGroup['kind'] | DuplicateCard['group']['kind']
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
      className={`cursor-default ${listRowClass(selected, false)}`}
    >
      <span className="relative shrink-0">
        <CoverPlaceholder testid="music-review-row-cover" />
        {staged && <ToneBadge testid="music-review-row-staged" tone="attention" />}
      </span>
      <span data-fit className="relative min-w-0 flex-1">
        <span data-testid="music-review-row-title-line" className="flex items-center gap-2">
          <span className="relative block min-w-0 flex-1 truncate">
            <span data-testid="music-review-row-name" className={ROW_TITLE}>
              {name}
            </span>
          </span>
          {count !== undefined && (
            <span data-testid="music-review-row-count" className={ROW_TRAILING}>
              {t('musicReview.tracks', { count })}
            </span>
          )}
        </span>
        <span data-testid="music-review-row-detail-line" className="flex items-center gap-2">
          <span data-testid="music-review-row-detail" className={ROW_DETAIL}>
            {detail}
            {staged && ` · ${t('musicReview.inTray')}`}
          </span>
          <span className="flex shrink-0 justify-end">
            <TonePill testid="music-review-row-pill" tone={RISKY_KINDS.has(kind) ? 'warn' : 'good'}>
              <span data-testid="music-review-row-kind" className={PILL_TEXT}>
                {t(`musicReview.badge.${kind}`)}
              </span>
            </TonePill>
          </span>
        </span>
      </span>
    </div>
  )
}

const TOOL =
  'press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint outline-none transition-colors hover:bg-[var(--color-hover)] hover:text-fg disabled:opacity-40'

// `busy` is a conversion running elsewhere in the app: it writes the same files and the
// same library databases, so nothing here may start a write until it ends.
export function MusicReview({
  review,
  selectedKey,
  onSelect,
  onClose,
  busy = false,
  search,
  onSearch,
  sort,
  onSort,
  confirming,
  onConfirming,
}: {
  review: Review
  selectedKey: string | null
  onSelect: (key: string) => void
  onClose: () => void
  busy?: boolean
  search: string
  onSearch: (value: string) => void
  sort: ReviewSort
  onSort: (sort: ReviewSort) => void
  confirming: boolean
  onConfirming: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const applying = review.status === 'applying'
  const [doneSeen, setDoneSeen] = useState<object | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const counts = {
    all: review.spelling.length + review.duplicates.length,
    spelling: review.spelling.length,
    duplicates: review.duplicates.length,
  }
  const visible = visibleGroups(review, search, sort)
  const keys = visibleKeys(review, search, sort)
  const at = selectedKey === null ? -1 : keys.indexOf(selectedKey)
  const nothing = review.status === 'ready' && counts.all === 0
  return (
    <div data-testid="music-review" className="relative flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--color-line)] bg-[var(--color-ink)]">
        <div className="flex items-center gap-1.5 px-1.5 pt-2">
          <SearchInput
            className="flex-1"
            testid="music-review-search"
            value={search}
            onChange={onSearch}
            onClear={() => onSearch('')}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              if (search) {
                e.stopPropagation()
                onSearch('')
              } else {
                e.currentTarget.blur()
              }
            }}
            ariaLabel={t('musicReview.search')}
            placeholder={t('musicReview.search')}
            clearLabel={t('sidebar.search.clear')}
          />
          <button
            type="button"
            data-testid="music-review-close"
            aria-label={t('musicReview.close')}
            className={TOOL}
            disabled={applying}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <Tooltip label={t('musicReview.close')} />
          </button>
        </div>
        <FilterBar
          testid="music-review-filter"
          trigger={{
            Icon: FILTER_ICONS[review.filter],
            label: t(`musicReview.filter.${review.filter}`),
            count: counts[review.filter],
          }}
          listLabel={t('musicReview.title')}
          focusTestId={`music-review-filter-${review.filter}`}
          options={(close) =>
            FILTERS.map((f) => (
              <FilterOption
                key={f}
                testid={`music-review-filter-${f}`}
                Icon={FILTER_ICONS[f]}
                label={t(`musicReview.filter.${f}`)}
                count={counts[f]}
                selected={review.filter === f}
                onClick={() => {
                  review.setFilter(f)
                  close()
                }}
              />
            ))
          }
          counterTestId="music-review"
          visibleCount={keys.length}
          selectedPosition={at < 0 ? null : at + 1}
          selectedCount={1}
          onRevealSelected={() =>
            listRef.current
              ?.querySelector('[aria-selected="true"]')
              ?.scrollIntoView({ block: 'nearest' })
          }
        >
          <Select
            testid="music-review-sort"
            bare
            value={sort}
            onChange={(v) => onSort(v as ReviewSort)}
            label={t('musicReview.sort.label')}
            options={[
              { value: 'default', label: t('sidebar.sort.import'), icon: ArrowDownUp },
              { value: 'name', label: t('sidebar.sort.name'), icon: CaseSensitive },
              { value: 'tracks', label: t('musicReview.sort.tracks'), icon: ListMusic },
            ]}
          />
        </FilterBar>
      </div>
      <div
        data-testid="music-review-scroll"
        className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-1.5"
      >
        {review.status === 'loading' && (
          <p
            data-testid="music-review-loading"
            aria-live="polite"
            className="p-1.5 text-xs text-fg-faint"
          >
            {t('musicReview.loading')}
          </p>
        )}
        {review.status === 'empty' && (
          <p data-testid="music-review-empty" className="p-1.5 text-xs text-fg-faint">
            {t('musicReview.empty')}
          </p>
        )}
        {review.status === 'error' && (
          <p data-testid="music-review-error" className="p-1.5 text-xs text-fg-faint">
            {t('musicReview.error')}
          </p>
        )}
        {nothing && (
          <p data-testid="music-review-clean" className="p-1.5 text-xs text-fg-faint">
            {t('musicReview.clean')}
          </p>
        )}
        {!nothing && search.trim() !== '' && keys.length === 0 && (
          <p data-testid="music-review-no-match" className="p-6 text-center text-xs text-fg-faint">
            {t('musicReview.noMatch')}
          </p>
        )}
        <div
          ref={listRef}
          role="listbox"
          aria-label={t('musicReview.title')}
          className="grid"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const options = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')]
            const next = Math.min(
              Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0),
              keys.length - 1,
            )
            if (next < 0) return
            onSelect(keys[next])
            options[next]?.focus()
          }}
        >
          {visible.spelling.map((g) => (
            <Row
              key={g.key}
              selected={g.key === selectedKey}
              staged={review.staged.has(g.key)}
              kind={g.kind}
              name={nameOf(review, g)}
              detail={fieldsLabel(t, g)}
              count={trackCount(g)}
              onSelect={() => onSelect(g.key)}
            />
          ))}
          {visible.duplicates.map((c) => (
            <Row
              key={c.group.key}
              selected={c.group.key === selectedKey}
              staged={review.staged.has(c.group.key)}
              kind={c.group.kind}
              name={duplicateName(c)}
              detail={
                c.group.kind === 'version'
                  ? t('musicReview.kind.version')
                  : t('musicReview.kind.duplicate', { count: c.entries.length })
              }
              onSelect={() => onSelect(c.group.key)}
            />
          ))}
        </div>
      </div>
      {confirming && <Confirm review={review} busy={busy} onCancel={() => onConfirming(false)} />}
      {(review.status === 'done' || review.status === 'ready') &&
        review.lastRun &&
        doneSeen !== review.lastRun && (
          <Done review={review} busy={busy} onContinue={() => setDoneSeen(review.lastRun)} />
        )}
    </div>
  )
}

function phaseLabel(t: TFunction, phase: ReviewPhase | null): string {
  if (phase === null) return t('musicReview.phase.verifying')
  if ('current' in phase)
    return t(`musicReview.phase.${phase.name}`, { current: phase.current, total: phase.total })
  return t(`musicReview.phase.${phase.name}`)
}

// The review's batch takes the toolbar's main button while the review is open: Apply with
// the count, and while it runs, the step it is on, pressed to stop.
export function MusicReviewAction({
  review,
  busy,
  onConfirm,
}: {
  review: Review
  busy: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const running = review.status === 'applying'
  const label = phaseLabel(t, review.phase)
  return (
    <>
      <span role="status" className="sr-only">
        {running ? label : ''}
      </span>
      <PrimaryAction
        testid="music-review-apply"
        Icon={ListChecks}
        label={t('musicReview.applyCount', {
          count: review.summary.tracks + review.summary.duplicates,
        })}
        running={running}
        runningLabel={
          <span key={review.phase?.name} className="animate-footer-swap inline-block">
            {label}
          </span>
        }
        cancelLabel={t('musicReview.stop')}
        ready={!busy && review.staged.size > 0}
        onRun={onConfirm}
        onCancel={review.cancel}
      />
    </>
  )
}

// The steps with a count fill the bar; the ones without (the libraries, the reread) and
// the wait for the first track slide it.
export function MusicReviewProgress({
  review,
  fallback = null,
}: {
  review: Review
  fallback?: React.ReactNode
}) {
  if (review.status !== 'applying') return fallback
  const { progress, phase } = review
  const counted =
    progress !== null &&
    progress.done > 0 &&
    phase?.name !== 'libraries' &&
    phase?.name !== 'verifying'
  return <TopProgressBar fraction={counted ? progress.done / progress.total : null} />
}
