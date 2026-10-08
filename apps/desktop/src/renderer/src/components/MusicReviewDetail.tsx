import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LibraryCopyInfo, LibraryStatus, MusicReviewEntry } from '../../../shared/types'
import type {
  DuplicateCard,
  MusicReview as Review,
  ReviewSpellingGroup,
} from '../hooks/useMusicReview'
import { INVISIBLE } from '../lib/musicSpelling'
import { fieldsLabel } from './MusicReview'
import { SectionBody } from './SectionBody'
import { SectionGroupHeading } from './SectionGroupHeading'
import { SectionHeader } from './SectionHeader'
import {
  FOOTER_BAR,
  SPLIT_BODY,
  SPLIT_BODY_READY,
  SPLIT_ITEM,
  SPLIT_MENU,
  SPLIT_TOGGLE,
  SPLIT_TOGGLE_READY,
  useSplitMenu,
} from './SplitButton'

export interface ReviewSync {
  rekordbox: boolean
  engineDj: boolean
  traktor: boolean
}

type Sections = Record<'options' | 'affected' | 'copies', boolean>
interface Folding {
  open: Sections
  toggle: (section: keyof Sections) => void
}

const NEXT_SECTION = 'mt-6 border-t border-[var(--color-line)] pt-6'

const tail = (path: string) => path.split('/').slice(-2).join('/')

const clock = (sec?: number) =>
  sec === undefined ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

function Header({ name, detail }: { name: string; detail: string }) {
  return (
    <header className="mb-6">
      <SectionGroupHeading label={name} testid="music-review-detail-heading" first />
      <p className="truncate text-xs text-fg-faint">{detail}</p>
    </header>
  )
}

// The group's own action, where the editor puts Convert: the full-width split button at the
// foot of the pane, with the rarer choice behind its chevron.
function GroupFooter({
  label,
  disabled,
  onStage,
  menuLabel,
  menuDisabled,
  onMenu,
}: {
  label: string
  disabled: boolean
  onStage: () => void
  menuLabel: string
  menuDisabled: boolean
  onMenu: () => void
}) {
  const { t } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  return (
    <div data-testid="music-review-footer" className={FOOTER_BAR}>
      <div ref={ref} className="group relative flex flex-1">
        <button
          type="button"
          data-testid="music-review-stage"
          disabled={disabled}
          onClick={onStage}
          className={`${SPLIT_BODY} ${SPLIT_BODY_READY}`}
        >
          <span aria-hidden="true" data-on className="process-fill" />
          <span className="relative">{label}</span>
        </button>
        <button
          type="button"
          data-testid="music-review-more"
          ref={toggleRef}
          aria-label={t('musicReview.moreActions')}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={menuDisabled}
          onClick={() => setOpen((v) => !v)}
          className={`${SPLIT_TOGGLE} ${SPLIT_TOGGLE_READY}`}
        >
          <span aria-hidden="true" data-on className="process-fill" />
          <ChevronDown
            aria-hidden="true"
            className={`relative h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('musicReview.moreActions')}
            onKeyDown={onMenuKeyDown}
            className={SPLIT_MENU}
          >
            <button
              type="button"
              role="menuitem"
              data-testid="music-review-ignore"
              onClick={() => {
                setOpen(false)
                onMenu()
              }}
              className={SPLIT_ITEM}
            >
              {menuLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const VISIBLY_INVISIBLE = new RegExp(INVISIBLE.source)
const MARK = 'text-[var(--color-warn)]'

// A stray space or an invisible character draws as nothing, so the two spellings would
// look identical; each one gets a mark where clean() would remove or squeeze it.
function Marked({
  value,
  changed,
  testId,
  tone,
}: {
  value: string
  changed?: [number, number]
  testId?: string
  tone?: string
}) {
  const chars = [...value]
  const visible = chars.map((c) => !VISIBLY_INVISIBLE.test(c))
  const spaceAt = (i: number, step: number) => {
    for (let j = i + step; j >= 0 && j < chars.length; j += step)
      if (visible[j]) return /\s/.test(chars[j])
    return true
  }
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const extra = /\s/.test(c) && (c !== ' ' || spaceAt(i, -1) || spaceAt(i, 1))
    nodes.push(
      !visible[i] || extra ? (
        <span key={i} className={MARK}>
          {visible[i] ? '␣' : '·'}
        </span>
      ) : (
        c
      ),
    )
  }
  if (!changed || changed[0] >= changed[1]) return <>{nodes}</>
  return (
    <>
      {nodes.slice(0, changed[0])}
      <span data-testid={testId} className={`font-semibold ${tone}`}>
        {nodes.slice(changed[0], changed[1])}
      </span>
      {nodes.slice(changed[1])}
    </>
  )
}

const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' })

function clusterBounds(chars: string[]): number[] {
  const bounds = [0]
  for (const { segment } of GRAPHEMES.segment(chars.join('')))
    bounds.push(bounds[bounds.length - 1] + [...segment].length)
  return bounds
}

// Credits often differ in one word out of many, so the shared start and end stay plain.
// The range snaps to whole letters so a combining accent is never split from its base.
function changedRanges(from: string, to: string): { from: [number, number]; to: [number, number] } {
  const a = [...from]
  const b = [...to]
  const max = Math.min(a.length, b.length)
  let start = 0
  while (start < max && a[start] === b[start]) start++
  let end = 0
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const snap = (chars: string[], range: [number, number]): [number, number] => {
    const bounds = clusterBounds(chars)
    const before = bounds.filter((x) => x <= range[0]).pop() ?? 0
    const after = bounds.find((x) => x >= range[1]) ?? chars.length
    return [before, after]
  }
  return { from: snap(a, [start, a.length - end]), to: snap(b, [start, b.length - end]) }
}

function Where({ sync, libraries }: { sync: ReviewSync; libraries: LibraryStatus | null }) {
  const { t } = useTranslation()
  const places = [
    { name: t('musicReview.where.music'), missing: false },
    { name: t('musicReview.where.file'), missing: false },
    ...(
      [
        [sync.rekordbox, 'rekordbox', 'rekordbox'],
        [sync.engineDj, 'engine', 'Engine DJ'],
        [sync.traktor, 'traktor', 'Traktor'],
      ] as const
    )
      .filter(([on]) => on)
      .map(([, library, name]) => ({ name, missing: libraries?.[library].found === false })),
  ]
  return (
    <span className="flex flex-wrap gap-1">
      {places.map((p) => (
        <span
          key={p.name}
          data-testid={p.missing ? 'music-review-where-missing' : undefined}
          title={p.missing ? t('musicReview.where.notFound') : undefined}
          className={`rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] whitespace-nowrap text-fg-dim ${p.missing ? 'line-through opacity-60' : ''}`}
        >
          {p.name}
        </span>
      ))}
    </span>
  )
}

function SpellingDetail({
  group,
  review,
  sync,
  folding,
}: {
  group: ReviewSpellingGroup
  review: Review
  sync: ReviewSync
  folding: Folding
}) {
  const { t } = useTranslation()
  const optionsId = useId()
  const affectedId = useId()
  const busy = review.status === 'applying'
  const chosen = review.choice(group.key)
  const staged = review.staged.has(group.key)
  const name = chosen ?? group.variants[0].value
  const options = [
    ...group.variants,
    ...(group.suggested !== null && !group.variants.some((v) => v.value === group.suggested)
      ? [{ value: group.suggested, persistentIds: [] }]
      : []),
  ]
  const affected = review.affected(group.key)
  return (
    <>
      <div data-testid="music-review-detail-scroll" className="min-h-0 flex-1 overflow-y-auto p-7">
        <Header
          name={name}
          detail={`${fieldsLabel(t, group)} · ${t(`musicReview.kind.${group.kind}`)}`}
        />
        <SectionHeader
          title={t('musicReview.detail.options')}
          open={folding.open.options}
          onToggle={() => folding.toggle('options')}
          bodyId={optionsId}
          summary={chosen ?? undefined}
        />
        <SectionBody open={folding.open.options} id={optionsId}>
          <div className="grid gap-2 pt-3">
            <div
              role="radiogroup"
              aria-label={`${fieldsLabel(t, group)} ${name}`}
              className="grid gap-0.5"
            >
              {options.map((v) => (
                <label
                  key={v.value}
                  data-testid="music-review-option"
                  className={`flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 ${chosen === v.value ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-hover)]'}`}
                >
                  <input
                    type="radio"
                    name={group.key}
                    checked={chosen === v.value}
                    disabled={busy}
                    onChange={() => review.choose(group.key, v.value)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="truncate text-sm whitespace-pre">
                    <Marked value={v.value} />
                  </span>
                  {chosen === v.value && (
                    <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)]">
                      {t('musicReview.keeps')}
                    </span>
                  )}
                  {v.persistentIds.length > 0 && (
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-faint">
                      {t('musicReview.tracks', { count: v.persistentIds.length })}
                    </span>
                  )}
                </label>
              ))}
            </div>
            {group.kind === 'invisible' && (
              <p className="text-xs text-fg-faint">{t('musicReview.detail.marks')}</p>
            )}
            {chosen === null && <p className="text-xs text-fg-faint">{t('musicReview.tie')}</p>}
          </div>
        </SectionBody>
        {affected.length > 0 && (
          <div className={NEXT_SECTION}>
            <SectionHeader
              title={t('musicReview.detail.affected')}
              open={folding.open.affected}
              onToggle={() => folding.toggle('affected')}
              bodyId={affectedId}
              status={<span className="tabular-nums">{affected.length}</span>}
            />
            <SectionBody open={folding.open.affected} id={affectedId}>
              <div className="grid gap-2 pt-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-fg-faint">
                      <tr className="border-b border-[var(--color-line)]">
                        <th className="py-1.5 pr-3 font-normal">{t('musicReview.field.title')}</th>
                        <th className="py-1.5 pr-3 font-normal">{t('musicReview.detail.field')}</th>
                        <th className="py-1.5 pr-3 font-normal">{t('musicReview.detail.now')}</th>
                        <th className="py-1.5 pr-3 font-normal">{t('musicReview.detail.after')}</th>
                        <th className="py-1.5 font-normal">{t('musicReview.detail.where')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affected.map((f) => {
                        const ranges = changedRanges(f.from, f.to)
                        return (
                          <tr
                            key={`${f.persistentId}|${f.field}`}
                            data-testid="music-review-affected"
                            className="border-b border-[var(--color-line)] align-top"
                          >
                            <td className="max-w-48 truncate py-1.5 pr-3">{f.title}</td>
                            <td className="py-1.5 pr-3 whitespace-nowrap text-fg-dim">
                              {t(`musicReview.field.${f.field}`)}
                            </td>
                            <td className="py-1.5 pr-3 whitespace-pre-wrap">
                              <Marked
                                value={f.from}
                                changed={ranges.from}
                                testId="music-review-diff-from"
                                tone="text-[var(--color-warn)]"
                              />
                            </td>
                            <td className="py-1.5 pr-3 whitespace-pre-wrap">
                              <Marked
                                value={f.to}
                                changed={ranges.to}
                                testId="music-review-diff-to"
                                tone="text-[var(--color-good)]"
                              />
                            </td>
                            <td className="py-1.5">
                              <Where sync={sync} libraries={review.libraries} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-fg-faint">{t('musicReview.detail.librariesNote')}</p>
              </div>
            </SectionBody>
          </div>
        )}
      </div>
      <GroupFooter
        label={
          staged
            ? t('musicReview.staged')
            : t('musicReview.unifyCount', {
                count: new Set(affected.map((f) => f.persistentId)).size,
              })
        }
        disabled={busy || chosen === null}
        onStage={() => review.toggleStaged(group.key)}
        menuLabel={t(group.kind === 'typo' ? 'musicReview.notSame' : 'musicReview.ignore')}
        menuDisabled={busy}
        onMenu={() => review.ignore(group.key)}
      />
    </>
  )
}

const LIBRARIES = [
  ['rekordbox', 'rekordbox'],
  ['engine', 'Engine DJ'],
  ['traktor', 'Traktor'],
] as const

const pathKey = (path: string) => path.normalize('NFC').toLowerCase()
const samePath = (a: string, b: string) => pathKey(a) === pathKey(b)

function CopyLibraries({ info }: { info: LibraryCopyInfo | undefined }) {
  const { t } = useTranslation()
  if (!info) return null
  return LIBRARIES.flatMap(([library, name]) => {
    const presence = info[library]
    if (presence === undefined) return []
    const text =
      presence === null
        ? t('musicReview.detail.notIn', { library: name })
        : [
            name,
            ...(presence.cues === undefined
              ? []
              : [t('musicReview.detail.cues', { count: presence.cues })]),
            ...(presence.playlists === undefined
              ? []
              : [t('musicReview.detail.playlists', { count: presence.playlists })]),
          ].join(' · ')
    return [
      <p key={library} data-testid="music-review-copy-library" className="text-xs text-fg-dim">
        {text}
      </p>,
    ]
  })
}

// Read when the detail opens, so a library changed since the review loaded is current.
function useCopyInfo(paths: string[]): Record<string, LibraryCopyInfo> {
  const [info, setInfo] = useState<Record<string, LibraryCopyInfo>>({})
  const key = paths.join('\0')
  useEffect(() => {
    let live = true
    setInfo({})
    if (key)
      window.api.libraryCopyInfo(key.split('\0')).then(
        (found) => {
          if (live) setInfo(found)
        },
        () => {},
      )
    return () => {
      live = false
    }
  }, [key])
  return info
}

function DuplicateDetail({
  card,
  review,
  folding,
}: {
  card: DuplicateCard
  review: Review
  folding: Folding
}) {
  const { t } = useTranslation()
  const copiesId = useId()
  const { group, entries, formats, locations } = card
  const info = useCopyInfo(entries.flatMap((e) => locations[e.persistentId] || []))
  const cuesStay = LIBRARIES.some(([library]) => {
    const held = entries.flatMap((e) => {
      const path = locations[e.persistentId]
      return path && info[path]?.[library] ? [pathKey(path)] : []
    })
    return new Set(held).size > 1
  })
  const busy = review.status === 'applying'
  const keep = review.choice(group.key)
  const anyFile = entries.some((e) => locations[e.persistentId] !== '')
  const unknown = entries.some((e) => !(e.persistentId in locations))
  const differs = (value: (e: MusicReviewEntry) => string) => new Set(entries.map(value)).size > 1
  const staged = review.staged.has(group.key)
  const version = group.kind === 'version'
  const first = entries[0]
  return (
    <>
      <div data-testid="music-review-detail-scroll" className="min-h-0 flex-1 overflow-y-auto p-7">
        <Header
          name={`${first?.artist} · ${first?.title}`}
          detail={
            version
              ? t('musicReview.kind.version')
              : t('musicReview.kind.duplicate', { count: entries.length })
          }
        />
        <SectionHeader
          title={t('musicReview.detail.copies')}
          open={folding.open.copies}
          onToggle={() => folding.toggle('copies')}
          bodyId={copiesId}
          status={<span className="tabular-nums">{entries.length}</span>}
        />
        <SectionBody open={folding.open.copies} id={copiesId}>
          <div className="grid gap-3 pt-3">
            <div
              role="radiogroup"
              aria-label={`${first?.artist} · ${first?.title}`}
              className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3"
            >
              {entries.map((e) => {
                const path = locations[e.persistentId]
                const noFile = path === ''
                const file =
                  path === undefined
                    ? t('musicReview.detail.unchecked')
                    : noFile
                      ? t('musicReview.detail.noFile')
                      : tail(path)
                const sameFile =
                  !!path &&
                  entries.some(
                    (o) =>
                      o !== e &&
                      !!locations[o.persistentId] &&
                      samePath(locations[o.persistentId], path),
                  )
                const cells = [
                  ['field.album', e.album, differs((c) => c.album)],
                  ['field.genre', e.genre, differs((c) => c.genre)],
                  ['detail.duration', clock(e.durationSec), differs((c) => clock(c.durationSec))],
                ] as const
                return (
                  <div
                    key={e.persistentId}
                    data-testid="music-review-copy"
                    className={`grid content-start gap-2.5 rounded-lg border p-3 ${keep === e.persistentId ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line)]'}`}
                  >
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={group.key}
                          checked={keep === e.persistentId}
                          disabled={busy || (noFile && anyFile)}
                          aria-label={[t('musicReview.keeps'), formats[e.persistentId], file]
                            .filter(Boolean)
                            .join(' ')}
                          onChange={() => review.choose(group.key, e.persistentId)}
                          className="accent-[var(--color-accent)]"
                        />
                        <span data-testid="music-review-copy-role">
                          {t(keep === e.persistentId ? 'musicReview.keeps' : 'musicReview.removes')}
                        </span>
                      </label>
                      {sameFile && (
                        <span
                          data-testid="music-review-same-file"
                          className="rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] text-fg-dim"
                        >
                          {t('musicReview.detail.sameFile')}
                        </span>
                      )}
                      <span
                        data-differs={differs((c) => formats[c.persistentId] ?? '') || undefined}
                        className={`ml-auto rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] ${differs((c) => formats[c.persistentId] ?? '') ? 'text-[var(--color-warn)]' : 'text-fg-dim'}`}
                      >
                        {formats[e.persistentId] ?? ''}
                      </span>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {cells.map(([label, value, differ]) => (
                        <div key={label} className="contents">
                          <dt className="text-fg-faint">{t(`musicReview.${label}`)}</dt>
                          <dd
                            data-differs={differ || undefined}
                            className={`truncate tabular-nums ${differ ? 'text-[var(--color-warn)]' : ''}`}
                          >
                            {value}
                          </dd>
                        </div>
                      ))}
                      <dt className="text-fg-faint">{t('musicReview.where.file')}</dt>
                      <dd
                        title={path}
                        className={`truncate ${noFile ? 'text-[var(--color-warn)]' : ''}`}
                      >
                        {file}
                      </dd>
                    </dl>
                    <CopyLibraries info={path ? info[path] : undefined} />
                  </div>
                )
              })}
            </div>
            {cuesStay && (
              <p data-testid="music-review-cues-note" className="text-xs text-fg-faint">
                {t('musicReview.detail.cuesNote')}
              </p>
            )}
          </div>
        </SectionBody>
      </div>
      <GroupFooter
        label={
          staged
            ? t('musicReview.staged')
            : t('musicReview.removeCopies', { count: entries.length - 1 })
        }
        disabled={busy || (unknown && !staged)}
        onStage={() => review.toggleStaged(group.key)}
        menuLabel={t(version ? 'musicReview.different' : 'musicReview.ignore')}
        menuDisabled={busy}
        onMenu={() => review.ignore(group.key)}
      />
    </>
  )
}

export function MusicReviewDetail({
  review,
  selectedKey,
  sync,
}: {
  review: Review
  selectedKey: string | null
  sync: ReviewSync
}) {
  const spelling = review.spelling.find((g) => g.key === selectedKey)
  const duplicate = review.duplicates.find((c) => c.group.key === selectedKey)
  // Held above the groups, like the editor's fold state, so a section folded on one group
  // stays folded on the next.
  const [open, setOpen] = useState<Sections>({ options: true, affected: true, copies: true })
  const folding: Folding = {
    open,
    toggle: (section) => setOpen((o) => ({ ...o, [section]: !o[section] })),
  }
  return (
    <section data-testid="music-review-detail" className="flex h-full min-h-0 flex-col">
      {spelling && (
        <SpellingDetail group={spelling} review={review} sync={sync} folding={folding} />
      )}
      {duplicate && <DuplicateDetail card={duplicate} review={review} folding={folding} />}
    </section>
  )
}
