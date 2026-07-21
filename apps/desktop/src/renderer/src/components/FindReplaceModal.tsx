import { ArrowRight } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../shared/types'
import { findReplaceTrack, isValidRegex } from '../lib/findReplace'
import type { TrackItem } from '../types'
import { ModalShell } from './ModalShell'

interface Props {
  tracks: TrackItem[]
  onApply: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  onClose: () => void
}

const PREVIEW_LIMIT = 6

// Bulk find/replace across the given tracks' text tags — the cleanup pass for messy rips.
// App scopes `tracks` to the selection-or-visible set, so an active filter never rewrites
// hidden rows. Plain or regex (with $1 capture groups); a live preview shows how many fields
// would change and a few before→after examples, so the user commits only once it looks right.
export function FindReplaceModal({ tracks, onApply, onClose }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [applied, setApplied] = useState(false)
  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    findInputRef.current?.focus()
  }, [])

  const badRegex = regex && find.length > 0 && !isValidRegex(find)
  // The preview runs the replacement over every field of every track — O(tracks × 15)
  // regex passes — so it recomputes only when an input actually changes, not on every
  // keystroke-induced render of the modal.
  const patches = useMemo(
    () =>
      find && !badRegex
        ? tracks
            .map((t) => ({
              id: t.id,
              meta: findReplaceTrack(t.meta, find, replace, { regex, caseSensitive }),
            }))
            .filter((p) => Object.keys(p.meta).length > 0)
        : [],
    [tracks, find, replace, regex, caseSensitive, badRegex],
  )
  const changedFields = patches.reduce((n, p) => n + Object.keys(p.meta).length, 0)
  const examples = useMemo(() => {
    const byId = new Map(tracks.map((t) => [t.id, t]))
    return patches
      .flatMap((p) =>
        Object.entries(p.meta).map(([field, after]) => ({
          id: p.id,
          field,
          before: byId.get(p.id)?.meta[field as keyof TrackMetadata] ?? '',
          after: after as string,
        })),
      )
      .slice(0, PREVIEW_LIMIT)
  }, [patches, tracks])

  // Cleaning a rip takes several passes ("1. ", then "2. ", then "3. "), so applying keeps the
  // panel up and resets it for the next pattern instead of closing — the user dismisses it when
  // they are done. `tracks` is live state from App, so the preview recomputes against the text
  // that was just rewritten.
  function apply(): void {
    if (!patches.length) return
    onApply(patches)
    setApplied(true)
    setFind('')
    setReplace('')
    findInputRef.current?.focus()
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="find-replace-backdrop"
      labelledBy="find-replace-title"
      className="flex max-h-[80vh] w-[560px] flex-col rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      onSubmit={apply}
    >
      <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <h2 id="find-replace-title" className="text-base font-semibold">
          {tr('findReplace.title')}
        </h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-fg-dim">
            <input
              type="checkbox"
              data-testid="find-replace-case"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            {tr('findReplace.caseSensitive')}
          </label>
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
      </div>

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-dim">
            {tr('findReplace.find')}
          </span>
          {/* In regex mode the delimiter slashes frame the field as chrome, not text the user
              types — so /Shake/ never gets searched literally (it wouldn't match) and it's
              obvious the field is a pattern. The slashes are pointer-events-none and live
              outside the value, so the bare pattern is what compiles. */}
          <div
            className={`flex items-center rounded-lg border bg-[var(--color-field)] ${
              badRegex
                ? 'border-danger focus-within:border-danger'
                : 'border-[var(--color-line)] focus-within:border-[var(--color-accent)]'
            }`}
          >
            {regex && (
              <span
                data-testid="find-replace-regex-slashes"
                aria-hidden="true"
                className="pointer-events-none select-none pl-3 font-mono text-fg-faint text-sm"
              >
                /
              </span>
            )}
            <input
              ref={findInputRef}
              data-testid="find-replace-find"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              aria-invalid={badRegex}
              spellCheck={false}
              className={`min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none ${
                regex ? 'pr-1 pl-1.5 font-mono' : ''
              }`}
            />
            {regex && (
              <span
                aria-hidden="true"
                className="pointer-events-none select-none pr-3 font-mono text-fg-faint text-sm"
              >
                /
              </span>
            )}
          </div>
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
          {applied ? tr('common.close') : tr('common.cancel')}
        </button>
        <button
          type="submit"
          data-testid="find-replace-apply"
          disabled={patches.length === 0}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {tr('findReplace.apply', { count: patches.length })}
        </button>
      </div>
    </ModalShell>
  )
}
