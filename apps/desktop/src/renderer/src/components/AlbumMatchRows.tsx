import { ArrowRight, Check, ChevronDown } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release } from '../../../shared/types'
import { type Assignment, assignTracks, reassign } from '../lib/assign'
import { matchTargetOf } from '../lib/autoMatch'
import { formatTime } from '../lib/duration'
import { buildReleaseMeta, confidenceTier, type ReleaseMetaPatch } from '../lib/release'
import type { TrackItem } from '../types'
import { Tooltip } from './Tooltip'

interface Props {
  files: TrackItem[]
  release: Release
  onApply: (patches: { id: string; patch: ReleaseMetaPatch }[]) => void
}

// The per-file mapping under a chosen release: auto-assigns each selected file to a
// tracklist entry (by duration, then title) and lets the user correct the few it is
// unsure about before applying title/track/artist to every file at once. Search lives
// in the editor's Discogs column; this only owns the assignment, so the two never
// reimplement the same Discogs plumbing.
export function AlbumMatchRows({ files, release, onApply }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  // Applying is otherwise silent, so flash the button to "Applied" for a moment as the
  // acknowledgement; it reverts so the user can apply again after a correction.
  const [justApplied, setJustApplied] = useState(false)
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => {
    if (!justApplied) return
    const id = setTimeout(() => setJustApplied(false), 2000)
    return () => clearTimeout(id)
  }, [justApplied])

  // Re-run the assignment only when the release or the set of selected files changes —
  // keyed on the file ids, not the array identity, so a manual reassignment below (or an
  // unrelated re-render) never silently rebuilds the matches and discards the fixes.
  const fileIds = files.map((f) => f.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesRef is read fresh; depending on `files` would rebuild every render and wipe manual reassignments. fileIds and release are the real triggers.
  useEffect(() => {
    setAssignments(
      assignTracks(
        filesRef.current.map((f) => ({
          id: f.id,
          target: matchTargetOf(f),
        })),
        release.tracklist,
      ),
    )
  }, [release, fileIds])

  function apply(): void {
    const patches = assignments.flatMap((a) => {
      const file = files.find((f) => f.id === a.id)
      if (!a.track || !file) return []
      // Match this file's text tags to its track, but keep any cover it already
      // carries rather than overwriting it with the release image — the same
      // non-destructive rule as the single-track editor. Files with no cover are
      // filled from the release.
      return [
        {
          id: a.id,
          patch: buildReleaseMeta(file.meta, release, a.track, {
            url: file.coverUrl,
            path: file.coverPath,
            keep: !!file.coverUrl,
          }),
        },
      ]
    })
    if (!patches.length) return
    onApply(patches)
    setJustApplied(true)
  }

  const matchedCount = assignments.filter((a) => a.track).length

  return (
    <div className="px-3 pb-2">
      <div className="flex flex-col gap-1">
        {assignments.map((a) => {
          const file = files.find((f) => f.id === a.id)
          if (!file) return null
          const tier = a.track ? confidenceTier(a.confidence) : undefined
          return (
            <div key={a.id} data-testid="match-row" className="flex items-center gap-3 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{file.meta.title || file.fileName}</span>
                {file.duration !== undefined && (
                  <span className="text-xs tabular-nums text-fg-dim">
                    {formatTime(file.duration)}
                  </span>
                )}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden="true" />
              <div className="relative min-w-0 flex-1">
                <select
                  data-testid={`match-select-${a.id}`}
                  value={a.track ? String(release.tracklist.indexOf(a.track)) : ''}
                  onChange={(e) => {
                    setJustApplied(false)
                    setAssignments((prev) =>
                      reassign(
                        prev,
                        a.id,
                        e.target.value === ''
                          ? undefined
                          : release.tracklist[Number(e.target.value)],
                      ),
                    )
                  }}
                  className="w-full appearance-none rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pr-8 pl-2 text-sm outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">{tr('match.unassigned')}</option>
                  {release.tracklist.map((track, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the index is the option's value (used to index tracklist) on a static, non-reordered list
                    <option key={`${track.position}-${track.title}-${i}`} value={String(i)}>
                      {[track.position, track.title].filter(Boolean).join(' ')}
                      {track.duration ? ` (${track.duration})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-fg-dim"
                />
              </div>
              <span className="w-4 shrink-0 text-center">
                {tier && tier !== 'low' && (
                  <span
                    data-testid={`match-confidence-${a.id}`}
                    data-confidence={tier}
                    role="img"
                    aria-label={tr('match.suggested')}
                    className={`group relative ${tier === 'high' ? 'text-good' : 'text-warn'}`}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <Tooltip label={tr('match.suggested')} align="end" />
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
        className={`press mt-3 w-full rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50 ${
          justApplied ? 'bg-good' : 'bg-[var(--color-accent)]'
        }`}
      >
        {justApplied ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <Check className="h-4 w-4" aria-hidden="true" />
            {tr('match.applied')}
          </span>
        ) : (
          tr('match.apply', { count: matchedCount })
        )}
      </button>
    </div>
  )
}
