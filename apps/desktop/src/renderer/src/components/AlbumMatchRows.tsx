import { ArrowRight, Check } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Release, ReleaseTrack } from '../../../shared/types'
import { type Assignment, assignTracks, reassign } from '../lib/assign'
import { matchTargetOf } from '../lib/autoMatch'
import { keepCoverArg } from '../lib/coverSource'
import { formatTime } from '../lib/duration'
import { buildReleaseMeta, confidenceTier, type ReleaseMetaPatch } from '../lib/release'
import type { TrackItem } from '../types'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

// "A1 So Right (Original Mix) (7:17)" — position + title, with the listed duration so two
// mixes of the same name stay tellable apart in the picker.
function trackLabel(track: ReleaseTrack): string {
  const head = [track.position, track.title].filter(Boolean).join(' ')
  return track.duration ? `${head} (${track.duration})` : head
}

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
        // Pass the album name so a file whose title belongs to neither it nor the
        // near-length cut is left unassigned instead of force-matched by duration alone.
        release.title,
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
          patch: buildReleaseMeta(file.meta, release, a.track, keepCoverArg(file)),
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
              <div className="min-w-0 flex-1">
                <Select
                  fullWidth
                  testid={`match-select-${a.id}`}
                  label={file.meta.title || file.fileName}
                  value={a.track ? String(release.tracklist.indexOf(a.track)) : ''}
                  onChange={(v) => {
                    setJustApplied(false)
                    setAssignments((prev) =>
                      reassign(prev, a.id, v === '' ? undefined : release.tracklist[Number(v)]),
                    )
                  }}
                  options={[
                    { value: '', label: tr('match.unassigned') },
                    ...release.tracklist.map((track, i) => ({
                      value: String(i),
                      label: trackLabel(track),
                    })),
                  ]}
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
