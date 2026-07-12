import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode } from '../../../shared/types'
import { DeclickControls } from './DeclickControls'
import { SectionHeader } from './SectionHeader'

interface Props {
  value: DeclickMode
  open: boolean
  onToggle: () => void
  onChange: (mode: DeclickMode) => void
}

// The per-track click-repair override, with the active mode badged on the header so
// a folded section still shows that the convert will repair clicks — the same
// contract as NormalizeSection's badge.
export function DeclickSection({ value, open, onToggle, onChange }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div data-testid="editor-declick" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('declick.title')}
        open={open}
        onToggle={onToggle}
        // Off is stated in the dim summary; active modes speak through the accent
        // badge instead, so the state renders exactly once either way.
        summary={value === 'off' ? tr('declick.mode.off') : undefined}
        summaryTestId="declick-summary"
        right={
          // Only while folded: open, the segmented control right below says the
          // same thing, and showing both reads as two controls for one fact.
          value !== 'off' && !open ? (
            <span
              data-testid="declick-active-badge"
              className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
            >
              {tr(`declick.mode.${value}`)}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-fg-dim">{tr('declick.editorHint')}</p>
          <DeclickControls value={value} onChange={onChange} />
          {value !== 'off' && (
            <p data-testid="declick-cue-warning" className="mt-3 text-xs text-warn">
              {tr('normalize.cueWarning')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
