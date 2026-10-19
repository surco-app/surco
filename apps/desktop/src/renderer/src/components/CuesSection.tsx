import { useQueryClient } from '@tanstack/react-query'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cueChanges, findDrops, isEmptyChange, SAME_POSITION_MS } from '../../../shared/cueRules'
import type { TrackCues } from '../../../shared/types'
import { useQueuedCues, useTrackCues } from '../hooks/useTrackCues'
import { CUE_COLOR } from '../lib/cueWave'
import { CueWave } from './CueWave'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'

const LEGEND: [number, string][] = [
  [1, 'editor.cues.legend16'],
  [22, 'editor.cues.legend32'],
  [42, 'editor.cues.legend48'],
  [32, 'editor.cues.legendStart'],
]

interface CueTarget {
  contentId: string
  path: string
  label: string
}

function Marking({
  read,
  queued,
  cue,
}: {
  read: TrackCues
  queued: number[] | null
  cue: CueTarget
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const queryClient = useQueryClient()
  const hot = read.cues.filter((c) => c.kind !== 0)
  const initial = useMemo(
    () =>
      findDrops(
        read.cues.filter((c) => c.kind === 0).map((c) => c.ms),
        read.cues.filter((c) => c.kind !== 0).map((c) => c.ms),
      ),
    [read],
  )
  const [drops, setDrops] = useState<number[]>(queued ?? initial)
  const beats = read.grid.map((b) => b.ms)
  const outcome = cueChanges(read.cues, drops, initial, beats, read.strong)
  const dirty = drops.length !== initial.length || drops.some((d) => !initial.includes(d))
  const refreshQueued = () => queryClient.invalidateQueries({ queryKey: ['rekordbox-queued-cues'] })
  const same = (ms: number, kind: number, color: number) =>
    hot.some((h) => Math.abs(h.ms - ms) <= SAME_POSITION_MS && h.kind === kind && h.color === color)
  const drawnHot =
    outcome.status === 'plan'
      ? outcome.hot.map((h) => ({ ...h, pending: !same(h.ms, h.kind, h.color) }))
      : hot.map((h) => ({ ms: h.ms, kind: h.kind, color: h.color, pending: false }))
  return (
    <>
      <CueWave
        wave={read.wave}
        grid={read.grid}
        durationMs={read.durationMs}
        hot={drawnHot}
        drops={drops.map((ms) => ({ ms, pending: !initial.includes(ms) }))}
        onAddDrop={(ms) =>
          setDrops((d) =>
            d.some((x) => Math.abs(x - ms) <= SAME_POSITION_MS)
              ? d
              : [...d, ms].sort((a, b) => a - b),
          )
        }
        onRemoveDrop={(ms) => setDrops((d) => d.filter((x) => x !== ms))}
      />
      {outcome.status === 'manual' && (
        <p data-testid="cues-manual" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.manual')}
        </p>
      )}
      {outcome.status === 'too-many' && (
        <p data-testid="cues-too-many" className="mt-2 text-xs text-warn">
          {tr('editor.cues.tooMany')}
        </p>
      )}
      <div data-testid="cues-actions" className="mt-3 flex flex-wrap items-center gap-3">
        <ul
          data-testid="cues-legend"
          className="flex flex-wrap items-center gap-3 text-[11px] text-fg-dim"
        >
          {LEGEND.map(([color, key]) => (
            <li key={key} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                style={{ backgroundColor: CUE_COLOR[color] }}
                className="h-2 w-2 rounded-sm"
              />
              {tr(key)}
            </li>
          ))}
        </ul>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="cues-undo"
            disabled={!dirty && queued === null}
            onClick={() => {
              setDrops(initial)
              if (queued !== null)
                void window.api.undoRekordboxCues(cue.contentId).then(refreshQueued)
            }}
            className="press whitespace-nowrap rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs hover:bg-[var(--color-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.undo')}
          </button>
          <button
            type="button"
            data-testid="cues-save"
            disabled={outcome.status === 'too-many' || (!dirty && isEmptyChange(outcome.changes))}
            onClick={() =>
              void window.api
                .saveRekordboxCues({
                  contentId: cue.contentId,
                  path: cue.path,
                  label: cue.label,
                  drops,
                  previousDrops: initial,
                  fingerprint: read.fingerprint,
                })
                .then(refreshQueued)
            }
            className="press whitespace-nowrap rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
          >
            {tr('editor.cues.save')}
          </button>
        </div>
      </div>
    </>
  )
}

export function CuesSection({
  cue,
  open,
  onToggle,
}: {
  cue: CueTarget
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { data: read, isError } = useTrackCues(cue.contentId)
  const { data: queued } = useQueuedCues(cue.contentId)
  return (
    <div data-testid="cues-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="cues"
        title={tr('editor.cues.title')}
        open={open}
        onToggle={onToggle}
        help={tr('editor.cues.help')}
      />
      <SectionBody open={open}>
        <div className="mt-3">
          {isError || read === null ? (
            <p data-testid="cues-unreadable" className="text-xs text-fg-dim">
              {tr('editor.cues.unreadable')}
            </p>
          ) : read === undefined || queued === undefined ? null : !read.analysed ||
            read.grid.length === 0 ? (
            <p data-testid="cues-unanalysed" className="text-xs text-fg-dim">
              {tr('editor.cues.unanalysed')}
            </p>
          ) : (
            <Marking
              key={`${read.fingerprint}|${queued?.join(',') ?? ''}`}
              read={read}
              queued={queued}
              cue={cue}
            />
          )}
        </div>
      </SectionBody>
    </div>
  )
}
