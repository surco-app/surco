import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { MatchingPartner } from '../lib/matchingPartners'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { MatchingIcon } from './SourceIcons'

export function MatchingSection({
  partners,
  onPick,
  open,
  onToggle,
}: {
  partners: MatchingPartner[]
  onPick: (partner: MatchingPartner) => void
  open: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (partners.length === 0) return null
  return (
    <div data-testid="matching-section" className="mt-6 border-t border-[var(--color-line)] pt-6">
      <SectionHeader
        sectionId="matching"
        title={tr('editor.matchingTitle')}
        open={open}
        onToggle={onToggle}
        summary={String(partners.length)}
      />
      <SectionBody open={open}>
        <ul className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
          {partners.map((p) => (
            <li key={p.contentId}>
              <button
                type="button"
                data-testid="matching-partner"
                onClick={() => onPick(p)}
                className="press flex w-full items-center gap-3 bg-[var(--color-panel)] px-3 py-2 text-left hover:bg-[var(--color-hover)]"
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
            </li>
          ))}
        </ul>
      </SectionBody>
    </div>
  )
}
