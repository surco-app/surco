import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionTrack } from '../../../shared/types'
import type { MatchingPartner } from '../lib/matchingPartners'
import { foldText } from '../lib/normalizeText'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { MatchingIcon } from './SourceIcons'

const RESULTS = 8

const focusOnMount = (el: HTMLInputElement | null): void => el?.focus()

function searchCollection(
  collection: readonly CollectionTrack[],
  query: string,
  skip: ReadonlySet<string>,
): CollectionTrack[] {
  const words = foldText(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const found: CollectionTrack[] = []
  for (const track of collection) {
    if (track.path === null || skip.has(track.contentId)) continue
    const text = foldText(`${track.artist} ${track.title}`)
    if (!words.every((w) => text.includes(w))) continue
    found.push(track)
    if (found.length === RESULTS) break
  }
  return found
}

export function MatchingSection({
  partners,
  selfId,
  collection,
  onPick,
  onRemove,
  onAdd,
  open,
  onToggle,
}: {
  partners: MatchingPartner[]
  selfId: string
  collection: readonly CollectionTrack[] | undefined
  onPick: (partner: MatchingPartner) => void
  onRemove: (partner: MatchingPartner) => void
  onAdd: (track: CollectionTrack) => void
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState<string | null>(null)
  const skip = useMemo(
    () => new Set([selfId, ...partners.map((p) => p.contentId)]),
    [selfId, partners],
  )
  const results = useMemo(
    () => (query && collection ? searchCollection(collection, query, skip) : []),
    [query, collection, skip],
  )
  return (
    <div data-testid="matching-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="matching"
        title={tr('editor.matchingTitle')}
        open={open}
        onToggle={onToggle}
        summary={partners.length > 0 ? String(partners.length) : undefined}
      />
      <SectionBody open={open}>
        {partners.length > 0 && (
          <ul className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
            {partners.map((p) => (
              <li
                key={p.contentId}
                className="group flex items-center bg-[var(--color-panel)] hover:bg-[var(--color-hover)]"
              >
                <button
                  type="button"
                  data-testid="matching-partner"
                  onClick={() => onPick(p)}
                  className="press flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                >
                  <MatchingIcon size={14} className="shrink-0 text-[var(--color-accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{p.title}</span>
                    <span className="block truncate text-xs text-fg-dim">{p.artist}</span>
                  </span>
                  {p.key && (
                    <span className="shrink-0 rounded border border-[var(--color-line-strong)] px-1 text-label text-fg-dim">
                      {p.key}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-testid="matching-partner-remove"
                  onClick={() => onRemove(p)}
                  className="press mr-2 shrink-0 rounded px-2 py-1 text-xs text-fg-dim opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {tr('editor.matchingRemove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query === null ? (
          <button
            type="button"
            data-testid="matching-add"
            onClick={() => setQuery('')}
            className="press mt-3 rounded-md px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
          >
            {tr('editor.matchingAdd')}
          </button>
        ) : (
          <div className="mt-3 flex flex-col gap-1">
            <input
              data-testid="matching-search"
              aria-label={tr('editor.matchingSearch')}
              placeholder={tr('editor.matchingSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQuery(null)
                }
              }}
              onBlur={(e) => {
                if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setQuery(null)
              }}
              ref={focusOnMount}
              className="rounded-md border border-[var(--color-input-border)] bg-[var(--color-field)] px-2.5 py-1.5 text-sm text-fg outline-none focus:border-[var(--color-accent)]"
            />
            {results.length > 0 && (
              <ul className="flex flex-col overflow-hidden rounded-lg border border-[var(--color-line)]">
                {results.map((track) => (
                  <li key={track.contentId}>
                    <button
                      type="button"
                      data-testid="matching-result"
                      onClick={() => {
                        setQuery(null)
                        onAdd(track)
                      }}
                      className="press flex w-full min-w-0 flex-col px-3 py-1.5 text-left hover:bg-[var(--color-hover)]"
                    >
                      <span className="truncate text-sm text-fg">{track.title}</span>
                      <span className="truncate text-xs text-fg-dim">{track.artist}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SectionBody>
    </div>
  )
}
