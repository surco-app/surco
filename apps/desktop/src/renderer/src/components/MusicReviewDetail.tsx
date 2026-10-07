import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DuplicateCard,
  MusicReview as Review,
  ReviewSpellingGroup,
} from '../hooks/useMusicReview'
import type { LibraryCopyInfo, MusicReviewEntry } from '../../../shared/types'
import { INVISIBLE } from '../lib/musicSpelling'
import { fieldsLabel, GHOST, PRIMARY } from './MusicReview'

export interface ReviewSync {
  rekordbox: boolean
  engineDj: boolean
  traktor: boolean
}

const HEADING = 'text-xs font-semibold text-fg-dim'

const tail = (path: string) => path.split('/').slice(-2).join('/')

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

const VISIBLY_INVISIBLE = new RegExp(INVISIBLE.source)
const MARK = 'text-[var(--color-warn)]'

// A stray space or an invisible character draws as nothing, so the two spellings would
// look identical; each one gets a mark where clean() would remove or squeeze it.
function Marked({ value }: { value: string }) {
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
  return <>{nodes}</>
}

function Where({ sync }: { sync: ReviewSync }) {
  const { t } = useTranslation()
  const places = [
    t('musicReview.where.music'),
    t('musicReview.where.file'),
    ...(sync.rekordbox ? ['rekordbox'] : []),
    ...(sync.engineDj ? ['Engine DJ'] : []),
    ...(sync.traktor ? ['Traktor'] : []),
  ]
  return (
    <span className="flex flex-wrap gap-1">
      {places.map((p) => (
        <span
          key={p}
          className="rounded bg-[var(--color-panel-2)] px-1.5 text-[11px] whitespace-nowrap text-fg-dim"
        >
          {p}
        </span>
      ))}
    </span>
  )
}

function SpellingDetail({
  group,
  review,
  sync,
}: {
  group: ReviewSpellingGroup
  review: Review
  sync: ReviewSync
}) {
  const { t } = useTranslation()
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
      </section>
      {affected.length > 0 && (
        <section className="grid gap-2">
          <h3 className={HEADING}>
            {t('musicReview.detail.affected')}{' '}
            <span className="tabular-nums text-fg-faint">{affected.length}</span>
          </h3>
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
                {affected.map((f) => (
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
                      <Marked value={f.from} />
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--color-good)]">{f.to}</td>
                    <td className="py-1.5">
                      <Where sync={sync} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-faint">{t('musicReview.detail.librariesNote')}</p>
        </section>
      )}
    </>
  )
}

const LIBRARIES = [
  ['rekordbox', 'rekordbox'],
  ['engine', 'Engine DJ'],
  ['traktor', 'Traktor'],
] as const

const samePath = (a: string, b: string) =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

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

function DuplicateDetail({ card, review }: { card: DuplicateCard; review: Review }) {
  const { t } = useTranslation()
  const { group, entries, formats, locations } = card
  const info = useCopyInfo(entries.flatMap((e) => locations[e.persistentId] || []))
  const cuesStay = LIBRARIES.some(
    ([library]) =>
      entries.filter((e) => info[locations[e.persistentId] ?? '']?.[library]).length > 1,
  )
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
          disabled={busy || (unknown && !staged)}
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
                o !== e && !!locations[o.persistentId] && samePath(locations[o.persistentId], path),
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
                <dd title={path} className={`truncate ${noFile ? 'text-[var(--color-warn)]' : ''}`}>
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
  return (
    <section data-testid="music-review-detail" className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-3xl gap-6 p-8">
        {spelling && <SpellingDetail group={spelling} review={review} sync={sync} />}
        {duplicate && <DuplicateDetail card={duplicate} review={review} />}
      </div>
    </section>
  )
}
