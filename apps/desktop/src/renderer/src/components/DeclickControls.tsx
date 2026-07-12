import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode } from '../../../shared/types'
import { SegmentedControl } from './SegmentedControl'

interface Props {
  value: DeclickMode
  onChange: (next: DeclickMode) => void
}

const MODES: readonly DeclickMode[] = ['off', 'soft', 'standard', 'strong']

// The click-repair picker, shared by Settings (global default) and the Editor
// (per-track override) exactly like NormalizeControls. Pure controlled component:
// ONE intensity ladder — off, gentle, standard, strong — each step a calibrated
// preset (see shared/declick.ts for the mapping and why the raw adeclick knobs
// are deliberately not exposed).
export function DeclickControls({ value, onChange }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div>
      <SegmentedControl
        options={MODES}
        value={value}
        onChange={onChange}
        testidPrefix="declick-mode"
        labelFor={(id) => tr(`declick.mode.${id}`)}
      />
      {value !== 'off' && (
        <p data-testid="declick-mode-hint" className="mt-2 text-xs text-fg-dim">
          {tr(`declick.modeHint.${value}`)}
        </p>
      )}
    </div>
  )
}
