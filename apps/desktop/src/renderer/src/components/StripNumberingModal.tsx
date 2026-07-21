import { ArrowRight } from 'lucide-react'
import type React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { stripTitleNumbering } from '../lib/hygiene'
import type { TrackItem } from '../types'
import { ModalShell } from './ModalShell'

interface Props {
  tracks: TrackItem[]
  onApply: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  onClose: () => void
}

const PREVIEW_LIMIT = 6

// Drops the track number rips glue to the front of the title ("1. Shake It", "A1 - Deep Cut").
// This exists because doing it through find/replace cannot work: searching "1." also matches
// inside "A1." and mangles vinyl positions, and deleting the number by hand leaves an orphan
// space. Anchoring to the start and closing the gap are one operation here.
// App scopes `tracks` the same way find/replace does, so an active filter never rewrites
// hidden rows, and the preview shows what changes before anything is committed.
export function StripNumberingModal({ tracks, onApply, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()

  const patches = useMemo(
    () =>
      tracks
        .map((t) => ({
          id: t.id,
          title: stripTitleNumbering(t.meta.title ?? ''),
          before: t.meta.title ?? '',
        }))
        .filter((p) => p.title !== p.before)
        .map((p) => ({ id: p.id, meta: { title: p.title }, before: p.before })),
    [tracks],
  )
  const examples = patches.slice(0, PREVIEW_LIMIT)

  function apply(): void {
    if (!patches.length) return
    onApply(patches.map((p) => ({ id: p.id, meta: p.meta })))
    onClose()
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="strip-numbering-backdrop"
      labelledBy="strip-numbering-title"
      className="flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      onSubmit={apply}
    >
      <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="strip-numbering-title" className="text-base font-semibold">
          {tr('stripNumbering.title')}
        </h2>
      </div>

      <p className="text-xs text-fg-dim">{tr('stripNumbering.hint')}</p>

      <div className="mt-3 min-h-[3rem] text-xs" data-testid="strip-numbering-preview">
        {patches.length === 0 ? (
          <p className="text-fg-faint">{tr('stripNumbering.noMatches')}</p>
        ) : (
          <>
            <p className="mb-1.5 text-fg-dim">
              {tr('stripNumbering.summary', { count: patches.length, total: tracks.length })}
            </p>
            <ul className="flex flex-col gap-1">
              {examples.map((ex) => (
                <li key={ex.id} className="flex items-center gap-2 truncate">
                  <span className="truncate text-fg-dim line-through">{ex.before}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
                  <span className="truncate text-fg">{ex.meta.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          data-testid="strip-numbering-cancel"
          onClick={onClose}
          className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
        >
          {tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="strip-numbering-apply"
          disabled={patches.length === 0}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {tr('stripNumbering.apply', { count: patches.length })}
        </button>
      </div>
    </ModalShell>
  )
}
