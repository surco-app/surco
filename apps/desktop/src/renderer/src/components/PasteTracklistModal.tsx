import { useQuery } from '@tanstack/react-query'
import { Info, X } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DjProgram } from '../../../shared/djProgram'
import type { CollectionTrack, PlaylistTrackRef, SourceNode } from '../../../shared/types'
import { SOURCE_READ } from '../lib/sourcePrograms'
import {
  chosenTracks,
  type MatchLevel,
  matchTracklist,
  type ReviewRow,
  reviewRows,
} from '../lib/tracklistMatch'
import { parseTracklist } from '../lib/tracklistParse'
import { ModalShell } from './ModalShell'
import { Tooltip } from './Tooltip'

interface Props {
  program: DjProgram
  node: SourceNode
  create: boolean
  onAdd: (tracks: PlaylistTrackRef[], newName: string | null) => void
  onClose: () => void
}

const DOT: Record<Exclude<MatchLevel, 'absent'>, string> = {
  found: 'bg-good',
  doubtful: 'bg-warn',
  similar: 'border border-fg-faint',
}

const LEVELS = ['found', 'doubtful', 'similar'] as const

const FILTER = 'press rounded-full px-2.5 py-0.5'
const FILTER_OFF = `${FILTER} text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg`
const FILTER_ON = `${FILTER} bg-[var(--color-accent-soft)] text-fg`

function mixOf(title: string): string {
  return title.match(/[([]([^)\]]*)[)\]]\s*$/)?.[1] ?? ''
}

function Candidate({ line, track }: { line: string; track: CollectionTrack }): React.JSX.Element {
  const mix = mixOf(track.title)
  const differs = mix && mix !== mixOf(line)
  const head = differs ? track.title.slice(0, track.title.lastIndexOf(`(${mix})`)) : track.title
  return (
    <>
      {track.artist && `${track.artist} - `}
      {head}
      {differs && (
        <em
          data-testid="paste-tracklist-mix-diff"
          className="not-italic text-fg underline decoration-dotted decoration-fg-faint underline-offset-2"
        >
          ({mix})
        </em>
      )}
    </>
  )
}

export function PasteTracklistModal({
  program,
  node,
  create,
  onAdd,
  onClose,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<'paste' | 'review'>('paste')
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [filter, setFilter] = useState<'all' | Exclude<MatchLevel, 'absent'>>('all')
  const parsed = useMemo(() => parseTracklist(text), [text])
  const collection = useQuery({
    queryKey: ['source-collection', program],
    queryFn: () => SOURCE_READ[program].collection?.() ?? Promise.resolve([]),
    enabled: step === 'review',
    staleTime: 60_000,
  })
  const matches = useMemo(
    () => (collection.data ? matchTracklist(parsed.lines, collection.data) : null),
    [collection.data, parsed.lines],
  )
  const review = rows ?? (matches ? reviewRows(matches) : null)
  const settled = collection.data !== undefined || collection.isError
  const chosen = review ? chosenTracks(review) : []
  const hasTimes = review?.some((row) => row.match.line.at) ?? false
  const playlistName = create ? name.trim() : node.name
  const canSearch = parsed.lines.length > 0 && playlistName !== ''

  const count = (level: MatchLevel): number => matches?.filter((m) => m.level === level).length ?? 0
  const update = (i: number, patch: Partial<ReviewRow>): void => {
    if (!review) return
    setRows(review.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }
  const submit = (): void => {
    if (step === 'paste') {
      if (canSearch) setStep('review')
      return
    }
    if (chosen.length === 0) return
    onAdd(
      chosen.map((t) => ({ contentId: t.contentId, paths: t.path ? [t.path] : [] })),
      create ? playlistName : null,
    )
    onClose()
  }

  return (
    <ModalShell
      onClose={text.trim() ? () => {} : onClose}
      backdropTestId="paste-tracklist-backdrop"
      dialogTestId="paste-tracklist-dialog"
      labelledBy="paste-tracklist-title"
      className={`${step === 'paste' ? 'w-[560px]' : 'w-[760px]'} max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6`}
      onSubmit={submit}
    >
      <div className="-mx-6 -mt-6 mb-4 border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <h2 id="paste-tracklist-title" className="text-base font-semibold">
            {create
              ? tr('pasteTracklist.titleNew')
              : tr('pasteTracklist.title', { name: node.name })}
          </h2>
          <button
            type="button"
            data-testid="paste-tracklist-close"
            onClick={onClose}
            aria-label={tr('common.close')}
            className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p data-testid="paste-tracklist-hint" className="mt-0.5 text-xs text-fg-dim">
          {step === 'paste'
            ? tr('pasteTracklist.hint')
            : collection.isError
              ? tr('pasteTracklist.failed')
              : count('absent') > 0 && tr('pasteTracklist.absent', { count: count('absent') })}
        </p>
      </div>

      {step === 'paste' ? (
        <>
          {create && (
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] text-fg-dim">
                {tr('pasteTracklist.name')}
              </span>
              <input
                data-testid="paste-tracklist-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          )}
          <textarea
            data-testid="paste-tracklist-text"
            aria-label={tr('pasteTracklist.hint')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={12}
            className="w-full resize-y rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-[var(--color-accent)]"
          />
          <div className="mt-5 flex items-center gap-2">
            <span data-testid="paste-tracklist-count" className="mr-auto text-xs text-fg-dim">
              {tr('pasteTracklist.count', { count: parsed.lines.length })}
              {parsed.gaps > 0 && `, ${tr('pasteTracklist.gaps', { count: parsed.gaps })}`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-hover)]"
            >
              {tr('common.cancel')}
            </button>
            <button
              type="submit"
              data-testid="paste-tracklist-search"
              disabled={!canSearch}
              className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {tr('pasteTracklist.search', { program: tr(`sources.${program}`) })}
            </button>
          </div>
        </>
      ) : (
        <>
          {!settled ? (
            <p className="py-8 text-center text-sm text-fg-dim">{tr('pasteTracklist.loading')}</p>
          ) : (
            <>
              <div
                data-testid="paste-tracklist-summary"
                className="mb-2.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-fg-dim"
              >
                <button
                  type="button"
                  data-testid="paste-tracklist-filter-all"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                  className={filter === 'all' ? FILTER_ON : FILTER_OFF}
                >
                  {tr('pasteTracklist.total', { count: review?.length ?? 0 })}
                </button>
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    data-testid={`paste-tracklist-filter-${level}`}
                    aria-pressed={filter === level}
                    onClick={() => setFilter(level)}
                    className={filter === level ? FILTER_ON : FILTER_OFF}
                  >
                    <span className={`mr-1.5 inline-block size-2 rounded-full ${DOT[level]}`} />
                    {tr(`pasteTracklist.${level}`, { count: count(level) })}
                  </button>
                ))}
                <span
                  data-testid="paste-tracklist-rules"
                  role="note"
                  className="relative ml-auto flex h-5 w-5 items-center justify-center text-fg-dim after:absolute after:-inset-0.5 after:content-[''] hover:text-fg-muted"
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">{tr('pasteTracklist.rules')}</span>
                  <Tooltip label={tr('pasteTracklist.rules')} />
                </span>
              </div>
              <ul className="max-h-[440px] overflow-y-auto rounded-[10px] border border-[var(--color-line)] bg-[var(--color-field)]">
                {review?.map((row, i) => {
                  const { match } = row
                  const level = match.level as Exclude<MatchLevel, 'absent'>
                  if (filter !== 'all' && level !== filter) return null
                  return (
                    <li
                      key={`${match.line.at ?? ''} ${match.line.raw}`}
                      data-testid={`paste-tracklist-row-${i}`}
                      className={`grid ${hasTimes ? 'grid-cols-[56px_8px_1fr_16px]' : 'grid-cols-[8px_1fr_16px]'} items-start gap-x-2.5 border-t border-[var(--color-line)] px-3 py-2 first:border-t-0${row.included ? '' : ' [&>*:not(input)]:opacity-45'}`}
                    >
                      {hasTimes && (
                        <span
                          data-testid={`paste-tracklist-at-${i}`}
                          className="font-mono text-[11px] leading-[18px] text-fg-faint tabular-nums"
                        >
                          {match.line.at ?? ''}
                        </span>
                      )}
                      <span className={`mt-[5px] size-2 rounded-full ${DOT[level]}`} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px]">
                          {match.line.raw}
                          {match.line.suggested && (
                            <small className="ml-1.5 text-fg-faint">
                              {tr('pasteTracklist.suggestedMark')}
                            </small>
                          )}
                        </div>
                        {match.candidates.length === 1 ? (
                          <div className="truncate text-xs text-fg-dim">
                            <Candidate line={match.line.title} track={match.candidates[0]} />
                            {level === 'similar' && match.line.artist && (
                              <span className="text-fg-faint">
                                {' '}
                                · {tr('pasteTracklist.otherArtist')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="mt-0.5 grid gap-0.5">
                            {match.candidates.map((c, j) => (
                              <label
                                key={c.contentId}
                                className="flex items-center gap-2 text-xs text-fg-dim"
                              >
                                <input
                                  type="radio"
                                  data-testid={`paste-tracklist-pick-${i}-${j}`}
                                  name={`paste-tracklist-pick-${i}`}
                                  checked={row.picked === j}
                                  onChange={() => update(i, { picked: j })}
                                  className="accent-[var(--color-accent)]"
                                />
                                <span className="truncate">
                                  <Candidate line={match.line.title} track={c} />
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        data-testid={`paste-tracklist-include-${i}`}
                        checked={row.included}
                        onChange={(e) => update(i, { included: e.target.checked })}
                        aria-label={tr('pasteTracklist.include', { line: match.line.raw })}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      />
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid="paste-tracklist-back"
              onClick={() => {
                setRows(null)
                setFilter('all')
                setStep('paste')
              }}
              className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-hover)]"
            >
              {tr('pasteTracklist.back')}
            </button>
            <button
              type="submit"
              data-testid="paste-tracklist-add"
              disabled={!settled || chosen.length === 0}
              className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {tr('pasteTracklist.add', { count: chosen.length })}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
