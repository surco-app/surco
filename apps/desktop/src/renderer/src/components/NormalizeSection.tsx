import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig } from '../../../shared/types'
import { NormalizeControls } from './NormalizeControls'
import { SectionHeader } from './SectionHeader'

interface Props {
  value: NormalizeConfig
  open: boolean
  onToggle: () => void
  onChange: (config: NormalizeConfig) => void
}

// The per-track normalization override, with the active mode badged on the header so
// a folded section still shows that the convert will normalize.
export function NormalizeSection({ value, open, onToggle, onChange }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div data-testid="editor-normalize" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('normalize.title')}
        open={open}
        onToggle={onToggle}
        right={
          value.mode !== 'none' ? (
            <span
              data-testid="normalize-active-badge"
              className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
            >
              {tr(`normalize.mode.${value.mode}`)}
            </span>
          ) : undefined
        }
      />
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
          <NormalizeControls value={value} onChange={onChange} />
        </div>
      )}
    </div>
  )
}
