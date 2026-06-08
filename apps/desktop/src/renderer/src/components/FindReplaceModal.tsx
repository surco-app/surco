import { ArrowRight } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { findReplaceTrack, isValidRegex } from '../lib/findReplace'
import type { TrackItem } from '../types'
import { useFocusTrap } from './useFocusTrap'

interface Props {
  tracks: TrackItem[]
  onApply: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  onClose: () => void
}

const PREVIEW_LIMIT = 6

// Bulk find/replace across every loaded track's text tags — the cleanup pass for messy rips.
// Plain or regex (with $1 capture groups); a live preview shows how many fields would change
// and a few before→after examples, so the user commits only once it looks right.
export function FindReplaceModal({ tracks, onApply, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  useFocusTrap(dialogRef)

  useEffect(() => {
    findInputRef.current?.focus()
  }, [])

  const badRegex = regex && find.length > 0 && !isValidRegex(find)
  const patches =
    find && !badRegex
      ? tracks
          .map((t) => ({ id: t.id, meta: findReplaceTrack(t.meta, find, replace, { regex }) }))
          .filter((p) => Object.keys(p.meta).length > 0)
      : []
  const changedFields = patches.reduce((n, p) => n + Object.keys(p.meta).length, 0)
  const examples = patches
    .flatMap((p) =>
      Object.entries(p.meta).map(([field, after]) => ({
        id: p.id,
        field,
        before: tracks.find((t) => t.id === p.id)?.meta[field as keyof TrackMetadata] ?? '',
        after: after as string,
      })),
    )
    .slice(0, PREVIEW_LIMIT)

  function apply(): void {
    if (!patches.length) return
    onApply(patches)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-testid="find-replace-backdrop"
        aria-label={tr('common.close')}
        onClick={onClose}
        className="animate-overlay absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="animate-pop relative z-10 flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
          <h2 className="text-base font-semibold">{tr('findReplace.title')}</h2>
          <label className="flex items-center gap-2 text-xs text-fg-dim">
            <input
              type="checkbox"
              data-testid="find-replace-regex"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
            />
            {tr('findReplace.regex')}
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-dim">
              {tr('findReplace.find')}
            </span>
            <input
              ref={findInputRef}
              data-testid="find-replace-find"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              aria-invalid={badRegex}
              spellCheck={false}
              className={`w-full rounded-lg border bg-[var(--color-field)] px-3 py-2 text-sm outline-none ${
                badRegex
                  ? 'border-danger focus:border-danger'
                  : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
              } ${regex ? 'font-mono' : ''}`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-dim">
              {tr('findReplace.replace')}
            </span>
            <input
              data-testid="find-replace-replace"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              spellCheck={false}
              className={`w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] ${
                regex ? 'font-mono' : ''
              }`}
            />
          </label>
        </div>

        <div className="mt-3 min-h-[3rem] text-xs" data-testid="find-replace-preview">
          {badRegex ? (
            <p className="text-danger">{tr('findReplace.invalidRegex')}</p>
          ) : !find ? (
            <p className="text-fg-faint">{tr('findReplace.hint')}</p>
          ) : patches.length === 0 ? (
            <p className="text-fg-faint">{tr('findReplace.noMatches')}</p>
          ) : (
            <>
              <p className="mb-1.5 text-fg-dim">
                {tr('findReplace.summary', { fields: changedFields, tracks: patches.length })}
              </p>
              <ul className="flex flex-col gap-1">
                {examples.map((ex) => (
                  <li key={`${ex.id}-${ex.field}`} className="flex items-center gap-2 truncate">
                    <span className="shrink-0 text-fg-faint">{tr(`fields.${ex.field}`)}</span>
                    <span className="truncate text-fg-dim line-through">{ex.before}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
                    <span className="truncate text-fg">{ex.after}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="find-replace-cancel"
            onClick={onClose}
            className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-panel-2)]"
          >
            {tr('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="find-replace-apply"
            onClick={apply}
            disabled={patches.length === 0}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {tr('findReplace.apply', { count: patches.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
