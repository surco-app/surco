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
  PILL_TONE,
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

type DestinationState = 'ok' | 'warn' | 'off'

interface Destination {
  id: string
  label: string
  state: DestinationState
  detail: string
}

const DESTINATION_ICON: Record<DestinationState, string> = { ok: '✓', warn: '!', off: '–' }
const DESTINATION_TONE: Record<DestinationState, string> = {
  ok: 'text-good',
  warn: 'text-warn',
  off: 'text-fg-faint',
}

const joined = (parts: (string | false)[]) => parts.filter(Boolean).join(' · ')

function Stat({ testId, value, label }: { testId: string; value: number; label: string }) {
  return (
    <div
      data-testid={`music-review-done-stat-${testId}`}
      className="rounded-lg border border-[var(--color-line)] px-3 py-2.5"
    >
      <span className="block text-xl font-semibold tabular-nums">{value}</span>
      <span className="block text-xs text-fg-dim">{label}</span>
    </div>
  )
}

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
  const missing = [
    ...new Set([
      ...missingLibraries(review),
      ...LIBRARIES.filter(([library]) => run.tagSync?.[library].outcome === 'missing').map(
        ([, name]) => name,
      ),
    ]),
  ]
  const reachedLibraries = run.librarySync !== 'none' || run.replaced.length > 0
  const libraryWarnings = LIBRARIES.flatMap(([library, name]) => {
    const count = (o: string) => run.replaced.filter((r) => r[library] === o).length
    const tags = run.tagSync?.[library].outcome
    return [
      ...(count('skipped') && !missing.includes(name)
        ? [t('musicReview.done.librarySkipped', { library: name })]
        : []),
      ...(count('failed') ? [t('musicReview.done.libraryReplaceFailed', { library: name })] : []),
      ...(tags === 'open' ? [t('musicReview.done.libraryTagsOpen', { library: name })] : []),
      ...(tags === 'failed' ? [t('musicReview.done.libraryTagsFailed', { library: name })] : []),
    ]
  })
  const failedRemovals = run.removed.filter(
    (r) => r.outcome === 'playlist-failed' || r.outcome === 'failed' || r.outcome === 'mismatch',
  ).length
  const corrected = run.outcomes.filter((o) => o.music.includes('set')).length
  const musicOnly = run.outcomes.filter(
    (o) => o.music.includes('set') && (o.file === 'unchanged' || o.file === 'missing'),
  ).length
  // Only a backup brings a file back; without one, setting Music back alone would leave
  // it saying one thing and the file another.
  const undoable = run.outcomes.some(
    (o) => o.backupId !== undefined || (o.file !== 'written' && o.music.includes('set')),
  )
  const musicFailed =
    run.outcomes.filter((o) => o.music.some((m) => m === 'failed' || m === 'mismatch')).length +
    failedRemovals
  const fileFailed = run.outcomes.filter((o) => o.file === 'failed').length
  const failed =
    run.outcomes.filter(
      (o) => o.file === 'failed' || o.music.some((m) => m === 'failed' || m === 'mismatch'),
    ).length + failedRemovals
  const warnings = [
    ...(undone ? [t('musicReview.done.undoFailed', { count: run.undoFailures })] : []),
    ...(!undone && failed > 0 ? [t('musicReview.done.failed', { count: failed })] : []),
    ...(!undone && run.applyError !== undefined ? [t('musicReview.done.applyError')] : []),
    ...(run.librarySync === 'failed' ? [t('musicReview.done.libraryFailed')] : []),
    ...(reachedLibraries
      ? missing.map((name) => t('musicReview.done.libraryMissing', { library: name }))
      : []),
    ...libraryWarnings,
    ...(run.librariesUntouched ? [t('musicReview.done.librariesUntouched')] : []),
  ]
  // Every library with its sync on gets a row: a library left out read as one that got
  // the change, which is what hid a rekordbox that got nothing.
  const libraryRow = (
    library: (typeof LIBRARIES)[number][0],
    name: (typeof LIBRARIES)[number][1],
  ): Destination | null => {
    const status = review.libraries?.[library]
    const row = (state: DestinationState, detail: string) => ({
      id: library,
      label: name,
      state,
      detail,
    })
    if (status && !status.enabled) return row('off', t('musicReview.done.where.off'))
    if (missing.includes(name)) return row('warn', t('musicReview.done.where.missing'))
    const outcomes = run.replaced.map((r) => r[library]).filter((o) => o !== undefined)
    const count = (o: string) => outcomes.filter((x) => x === o).length
    const tags = run.tagSync?.[library]
    if (count('skipped')) return row('warn', t('musicReview.done.where.skipped'))
    if (count('failed') || tags?.outcome === 'failed')
      return row('warn', t('musicReview.done.where.replaceFailed'))
    if (tags?.outcome === 'open') return row('warn', t('musicReview.done.where.open'))
    if (status && run.librariesUntouched) return row('warn', t('musicReview.done.where.untouched'))
    if (status && run.librarySync === 'failed')
      return row('warn', t('musicReview.done.where.unconfirmed'))
    if (!status && !outcomes.length && !tags) return null
    const moved = count('replaced') + count('repointed')
    const held = library === 'traktor' ? 0 : count('replaced')
    const updated = tags?.outcome === 'updated' ? tags.count : 0
    if (tags?.outcome === 'nothing' && !outcomes.length)
      return row('off', t('musicReview.done.where.noMatch'))
    return row(
      'ok',
      joined([
        updated > 0 && t('musicReview.done.where.updated', { count: updated }),
        moved > 0 && t('musicReview.done.where.replaced', { count: moved }),
        held > 0 && t('musicReview.done.where.held', { count: held }),
      ]) ||
        (outcomes.length ? t('musicReview.done.where.none') : t('musicReview.done.where.nothing')),
    )
  }
  const written = run.outcomes.filter((o) => o.file === 'written').length
  const backups = run.outcomes.filter((o) => o.backupId !== undefined).length
  const destinations: Destination[] = undone
    ? []
    : [
        ...(run.outcomes.length || run.removed.length || run.applyError !== undefined
          ? [
              {
                id: 'music',
                label: 'Apple Music',
                state: run.applyError !== undefined || musicFailed ? 'warn' : 'ok',
                detail:
                  run.applyError !== undefined
                    ? t('musicReview.done.where.notApplied')
                    : joined([
                        corrected > 0 && t('musicReview.done.where.tracks', { count: corrected }),
                        removed > 0 && t('musicReview.done.where.removed', { count: removed }),
                        musicFailed > 0 &&
                          t('musicReview.done.where.failed', { count: musicFailed }),
                      ]) || t('musicReview.done.where.nothing'),
              } as const,
            ]
          : []),
        ...(run.outcomes.length
          ? [
              {
                id: 'files',
                label: t('musicReview.done.where.files'),
                state: fileFailed ? 'warn' : 'ok',
                detail:
                  joined([
                    written > 0 && t('musicReview.done.where.written', { count: written }),
                    backups > 0 && t('musicReview.done.where.backups', { count: backups }),
                    musicOnly > 0 && t('musicReview.done.where.musicOnly', { count: musicOnly }),
                    fileFailed > 0 && t('musicReview.done.where.fileFailed', { count: fileFailed }),
                  ]) || t('musicReview.done.where.nothing'),
              } as const,
            ]
          : []),
        ...LIBRARIES.flatMap(([library, name]) => libraryRow(library, name) ?? []),
        ...(trashed || keptForLibrary
          ? [
              {
                id: 'trash',
                label: t('musicReview.done.where.trash'),
                state: 'ok',
                detail: joined([
                  trashed > 0 && t('musicReview.done.where.trashed', { count: trashed }),
                  keptForLibrary > 0 && t('musicReview.done.where.kept', { count: keptForLibrary }),
                ]),
              } as const,
            ]
          : []),
      ]
  const warned = warnings.length > 0
  const librariesShort = destinations.some(
    (d) => d.state === 'warn' && LIBRARIES.some(([library]) => library === d.id),
  )
  return (
    <Sheet
      testId="music-review-done"
      titleId="music-review-done-title"
      onClose={onContinue}
      primaryRef={continueRef}
    >
      <div className="flex items-center gap-3">
        <span
          data-testid="music-review-done-badge"
          data-tone={warned ? 'warn' : 'good'}
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${PILL_TONE[warned ? 'warn' : 'good']}`}
        >
          {warned ? '!' : '✓'}
        </span>
        <div className="min-w-0">
          <h3
            id="music-review-done-title"
            data-testid="music-review-done-title"
            className="text-base font-semibold"
          >
            {warned
              ? t('musicReview.done.titleWarnings', { count: warnings.length })
              : t('musicReview.done.title')}
          </h3>
          <p data-testid="music-review-done-subtitle" className="mt-0.5 text-sm text-fg-dim">
            {musicOnly > 0
              ? t('musicReview.done.subtitleMusicOnly', { count: musicOnly })
              : librariesShort
                ? t('musicReview.done.subtitleLibraries')
                : t('musicReview.done.subtitle')}
          </p>
        </div>
      </div>
      {warned && (
        <div
          data-testid="music-review-done-warnings"
          className="grid gap-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm"
        >
          <p data-testid="music-review-done-warnings-title" className="font-semibold text-warn">
            {t('musicReview.done.warnings', { count: warnings.length })}
          </p>
          {warnings.map((line) => (
            <p key={line} data-testid="music-review-done-warning" className="text-fg-dim">
              {line}
            </p>
          ))}
        </div>
      )}
      {!undone && (
        <div
          data-testid="music-review-done-stats"
          className="grid auto-cols-fr grid-flow-col gap-2"
        >
          <Stat
            testId="corrected"
            value={corrected}
            label={t('musicReview.done.stat.corrected', { count: corrected })}
          />
          <Stat
            testId="removed"
            value={removed}
            label={t('musicReview.done.stat.removed', { count: removed })}
          />
        </div>
      )}
      {destinations.length > 0 && (
        <>
          <h4
            data-testid="music-review-done-where"
            className="text-[13px] font-semibold text-fg-muted"
          >
            {t('musicReview.done.where.title')}
          </h4>
          <div className="grid gap-1.5">
            {destinations.map((d) => (
              <div
                key={d.id}
                data-testid={`music-review-done-dest-${d.id}`}
                data-state={d.state}
                className="flex items-baseline gap-2.5 rounded-lg border border-[var(--color-line)] px-4 py-2.5"
              >
                <span
                  data-testid="music-review-done-dest-icon"
                  aria-hidden="true"
                  className={`w-3 shrink-0 text-center text-sm ${DESTINATION_TONE[d.state]}`}
                >
                  {DESTINATION_ICON[d.state]}
                </span>
                <span
                  data-testid="music-review-done-dest-label"
                  className={`shrink-0 text-sm font-medium ${d.state === 'off' ? 'text-fg-faint' : ''}`}
                >
                  {d.label}
                </span>
                <span
                  data-testid="music-review-done-dest-detail"
                  className={`min-w-0 flex-1 text-right text-xs tabular-nums ${d.state === 'off' ? 'text-fg-faint' : 'text-fg-dim'}`}
                >
                  {d.detail}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {removed > 0 && (
        <p data-testid="music-review-done-note" className="text-xs text-fg-faint">
          {t('musicReview.removedNoUndo')}
        </p>
      )}
      <div className="flex items-center gap-1.5">
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
          className={`ml-auto ${OK}`}
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

const trackCount = (g: ReviewSpellingGroup) => new Set(g.variants.flatMap((v) => v.ids)).size

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
        onCancel={review.undoing ? undefined : review.cancel}
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
