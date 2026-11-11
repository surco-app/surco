import { useQueryClient } from '@tanstack/react-query'
import { Grid2x2Check } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { programOf } from '../../../shared/djProgram'
import { type GridCheck, needsGridFix } from '../../../shared/gridCheck'
import type { AutoMarkTarget } from '../lib/cueAutoMark'
import { adjustGrids } from '../lib/cueGridBatch'
import { cueProgramOf } from '../lib/cuePrograms'
import { type GridAdjust, undoGridAdjusts, useGridAdjusts } from '../lib/cueSession'
import { formatUpTo } from '../lib/numberFormat'
import { LIBRARY_NAME } from '../lib/reviewLibraries'
import { useAppSettings } from '../lib/settingsContext'

const PRIMARY =
  'press inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40'
const LINK = 'press text-xs text-fg-dim hover:text-fg'

export function GridBatchBlock({
  targets,
  checkOf,
  onShowInList,
  onOpen,
}: {
  targets: AutoMarkTarget[]
  checkOf: (contentId: string) => GridCheck | null | undefined
  onShowInList: () => void
  onOpen: (contentId: string) => void
}): React.JSX.Element | null {
  const { t: tr, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useAppSettings()
  const adjusts = useGridAdjusts()
  const [busy, setBusy] = useState(false)
  if (targets.every((t) => cueProgramOf(t.contentId).fixedGrid !== null)) return null
  const checks = targets.map((t) => checkOf(t.contentId))
  const done = checks.filter((c) => c !== undefined).length
  const measuring = done < targets.length
  const count = checks.filter((c) => c && needsGridFix(c, settings.cueGridTolerance)).length
  const rest = targets.length - count
  const adjustOf = (contentId: string) => adjusts.get(contentId)
  const ofKind = (kind: GridAdjust['kind']) =>
    targets.filter((t) => adjustOf(t.contentId)?.kind === kind).length
  const tally = [
    ['adjusted', tr('editor.cues.gridBatch.adjusted'), ofKind('adjusted')],
    ['fine', tr('editor.cues.gridBatch.fine'), ofKind('fine')],
    ['unmeasured', tr('editor.cues.gridBatch.unmeasured'), ofKind('unmeasured')],
    ['review', tr('editor.cues.gridBatch.review'), ofKind('review')],
  ] as const
  const bpm = (value: number) => formatUpTo(value, 1, i18n.language)
  const reasonOf = (contentId: string, adjust: GridAdjust & { kind: 'review' }) => {
    const { reason } = adjust
    if (reason.kind === 'tempo')
      return tr('editor.cues.gridBatch.tempo', {
        heard: bpm(reason.heardBpm),
        program: LIBRARY_NAME[programOf(contentId)],
        bpm: bpm(reason.programBpm),
      })
    if (reason.kind === 'cueJump')
      return tr('editor.cues.gridBatch.cueJump', { ms: Math.round(Math.abs(reason.ms)) })
    if (reason.kind === 'noBetter') return tr('editor.cues.gridBatch.noBetter')
    return tr(reason.key)
  }
  const review = targets.flatMap((target) => {
    const adjust = adjustOf(target.contentId)
    return adjust?.kind === 'review' ? [{ target, reason: reasonOf(target.contentId, adjust) }] : []
  })
  const adjust = async () => {
    setBusy(true)
    try {
      await adjustGrids(queryClient, targets, settings)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="grid-batch" className="mt-5 border-t border-[var(--color-line)] pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium text-fg-muted">{tr('editor.cues.gridBatch.title')}</p>
        <button type="button" data-testid="grid-batch-show" onClick={onShowInList} className={LINK}>
          {tr('editor.cues.gridBatch.show')}
        </button>
      </div>
      {measuring ? (
        <p data-testid="grid-batch-measuring" className="mt-2 text-xs text-fg-dim">
          {tr('editor.cues.gridBatch.measuring', { done, total: targets.length })}
        </p>
      ) : (
        <p data-testid="grid-batch-summary" className="mt-2 text-xs text-fg-dim">
          {count === 0
            ? tr('editor.cues.gridBatch.allFine')
            : [
                tr('editor.cues.gridBatch.needs', { count, total: targets.length }),
                ...(rest > 0 ? [tr('editor.cues.gridBatch.rest', { count: rest })] : []),
              ].join(' ')}
        </p>
      )}
      {(measuring || count > 0) && (
        <div className="mt-3">
          <button
            type="button"
            data-testid="grid-batch-adjust"
            disabled={measuring || busy}
            onClick={() => void adjust()}
            className={PRIMARY}
          >
            <Grid2x2Check className="h-3.5 w-3.5" aria-hidden="true" />
            {tr('editor.cues.gridBatch.adjust', { count })}
          </button>
        </div>
      )}
      {tally.some(([, , n]) => n > 0) && (
        <dl data-testid="grid-batch-tally" className="mt-3 grid gap-1 text-xs">
          {tally
            .filter(([, , n]) => n > 0)
            .map(([kind, label, n]) => (
              <div
                key={kind}
                className={`flex justify-between gap-4 ${kind === 'review' ? 'text-warn' : 'text-fg-dim'}`}
              >
                <dt>{label}</dt>
                <dd className={`tabular-nums ${kind === 'review' ? 'text-warn' : 'text-fg'}`}>
                  {n}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {review.length > 0 && (
        <div
          data-testid="grid-batch-review"
          className="mt-3 rounded-lg border border-[var(--color-line)] text-xs"
        >
          <p className="px-3 pt-2.5 pb-1.5 text-fg-dim">
            {tr('editor.cues.gridBatch.reviewTitle')}
          </p>
          <ul>
            {review.map(({ target, reason }) => (
              <li
                key={target.contentId}
                data-testid={`grid-batch-review-${target.contentId}`}
                className="flex items-center gap-3 border-t border-[var(--color-line)] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg">{target.label}</p>
                  <p className="text-fg-dim">{reason}</p>
                </div>
                <button
                  type="button"
                  data-testid={`grid-batch-open-${target.contentId}`}
                  onClick={() => onOpen(target.contentId)}
                  className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] px-2.5 py-1 text-xs text-fg-muted transition-colors hover:text-fg"
                >
                  {tr('editor.cues.gridBatch.open')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ofKind('adjusted') > 0 && (
        <button
          type="button"
          data-testid="grid-batch-undo"
          onClick={() => undoGridAdjusts(targets.map((t) => t.contentId))}
          className={`mt-3 ${LINK}`}
        >
          {tr('editor.cues.gridBatch.undo')}
        </button>
      )}
    </div>
  )
}
