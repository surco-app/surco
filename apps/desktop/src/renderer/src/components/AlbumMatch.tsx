import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscogsRelease, DiscogsSearchResult } from '../../../shared/types'
import { type Assignment, assignTracks, reassign } from '../lib/assign'
import { formatTime } from '../lib/duration'
import {
  buildReleaseMeta,
  confidenceTier,
  type ReleaseMetaPatch,
  resultFromRelease,
} from '../lib/release'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'

interface Props {
  files: TrackItem[]
  onApply: (patches: { id: string; patch: ReleaseMetaPatch }[]) => void
}

// The album-matching section of the bulk panel: search Discogs once for the whole
// selection, then auto-assign each file to a distinct tracklist entry (by duration and
// title) and let the user correct the few the matcher is unsure about before applying
// title/track/artist to every file at once. Kept apart from the single-track Editor's
// own Discogs panel so neither has to grow conditionals for the other's flow.
export function AlbumMatch({ files, onApply }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState(files[0]?.query ?? '')
  const [results, setResults] = useState<DiscogsSearchResult[]>([])
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const releaseRef = useRef<DiscogsRelease | null>(null)
  const filesRef = useRef(files)
  filesRef.current = files

  async function loadRelease(id: number): Promise<DiscogsRelease> {
    if (releaseRef.current?.id === id) return releaseRef.current
    const rel = await window.api.getRelease(id)
    releaseRef.current = rel
    return rel
  }

  async function doSearch(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setError('')
    setRelease(null)
    try {
      const id = parseReleaseId(query)
      if (id !== null) {
        const rel = await loadRelease(id)
        setResults([resultFromRelease(rel)])
        setRelease(rel)
      } else {
        setResults(await window.api.searchDiscogs(query))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('match.error'))
    } finally {
      setBusy(false)
    }
  }

  // Clicking the expanded release collapses it back to the plain list; clicking any
  // other result switches to it — so the results stay on screen and the user can change
  // albums without searching again.
  async function pickRelease(result: DiscogsSearchResult): Promise<void> {
    if (release?.id === result.id) {
      setRelease(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      setRelease(await loadRelease(result.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('match.error'))
    } finally {
      setBusy(false)
    }
  }

  // Re-run the assignment only when the release or the set of selected files changes —
  // keyed on the file ids, not the array identity, so editing a field (or a manual
  // reassignment below) never silently rebuilds the matches and discards the user's fixes.
  const fileIds = files.map((f) => f.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesRef is read fresh; depending on `files` itself would rebuild on every render and wipe manual reassignments. fileIds is the real trigger.
  useEffect(() => {
    if (!release) {
      setAssignments([])
      return
    }
    setAssignments(
      assignTracks(
        filesRef.current.map((f) => ({
          id: f.id,
          target: {
            title: f.meta.title,
            durationSec: f.duration,
            trackNumber: f.meta.trackNumber,
            artist: f.meta.artist,
          },
        })),
        release.tracklist,
      ),
    )
  }, [release, fileIds])

  function apply(): void {
    if (!release) return
    const patches = assignments.flatMap((a) => {
      const file = files.find((f) => f.id === a.id)
      if (!a.track || !file) return []
      return [{ id: a.id, patch: buildReleaseMeta(file.meta, release, a.track, file.coverUrl) }]
    })
    if (patches.length) onApply(patches)
  }

  const matchedCount = assignments.filter((a) => a.track).length

  return (
    <section className="mt-6 border-t border-[var(--color-line)] pt-5" data-testid="album-match">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-faint">
        {tr('match.title')}
      </h3>

      <div className="flex gap-2">
        <input
          data-testid="match-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
          placeholder={tr('match.searchPlaceholder')}
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          data-testid="match-search"
          onClick={() => void doSearch()}
          disabled={busy || !query.trim()}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {tr('match.search')}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {results.map((r) => {
            const expanded = release?.id === r.id
            return (
              <li key={r.id} className="overflow-hidden rounded-lg">
                <button
                  type="button"
                  data-testid="match-result"
                  aria-expanded={expanded}
                  onClick={() => void pickRelease(r)}
                  className={`flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm ${
                    expanded ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-panel-2)]'
                  }`}
                >
                  {r.cover_image && (
                    <img src={r.cover_image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  {r.year && <span className="shrink-0 text-xs text-fg-dim">{r.year}</span>}
                </button>
                {expanded && release && (
                  <div className="px-2 pt-1 pb-2">
                    <div className="flex flex-col gap-1">
                      {assignments.map((a) => {
                        const file = files.find((f) => f.id === a.id)
                        if (!file) return null
                        const tier = a.track ? confidenceTier(a.confidence) : undefined
                        return (
                          <div
                            key={a.id}
                            data-testid="match-row"
                            className="flex items-center gap-3 py-1"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">
                                {file.meta.title || file.fileName}
                              </span>
                              {file.duration !== undefined && (
                                <span className="text-xs tabular-nums text-fg-dim">
                                  {formatTime(file.duration)}
                                </span>
                              )}
                            </span>
                            <span aria-hidden="true" className="text-fg-faint">
                              →
                            </span>
                            <div className="grid min-w-0 flex-1 grid-cols-1">
                              <select
                                data-testid={`match-select-${a.id}`}
                                value={a.track ? String(release.tracklist.indexOf(a.track)) : ''}
                                onChange={(e) =>
                                  setAssignments((prev) =>
                                    reassign(
                                      prev,
                                      a.id,
                                      e.target.value === ''
                                        ? undefined
                                        : release.tracklist[Number(e.target.value)],
                                    ),
                                  )
                                }
                                className="col-start-1 row-start-1 w-full appearance-none rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pr-8 pl-2 text-sm outline-none focus:border-[var(--color-accent)]"
                              >
                                <option value="">{tr('match.unassigned')}</option>
                                {release.tracklist.map((track, i) => (
                                  <option
                                    key={`${track.position}-${track.title}-${i}`}
                                    value={String(i)}
                                  >
                                    {[track.position, track.title].filter(Boolean).join(' ')}
                                    {track.duration ? ` (${track.duration})` : ''}
                                  </option>
                                ))}
                              </select>
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="pointer-events-none col-start-1 row-start-1 mr-2 size-4 self-center justify-self-end text-fg-dim"
                              >
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </div>
                            <span className="w-4 shrink-0 text-center">
                              {tier && tier !== 'low' && (
                                <span
                                  data-testid={`match-confidence-${a.id}`}
                                  data-confidence={tier}
                                  title={tr('match.suggested')}
                                  className={tier === 'high' ? 'text-good' : 'text-warn'}
                                >
                                  ✓
                                </span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      data-testid="match-apply"
                      onClick={apply}
                      disabled={matchedCount === 0}
                      className="press mt-3 w-full rounded-lg bg-[var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {tr('match.apply', { count: matchedCount })}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
