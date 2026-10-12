import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode } from '../../../shared/types'
import { SegmentedControl } from './SegmentedControl'
import { CheckboxRow } from './settings/CheckboxRow'

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
        label={tr('declick.title')}
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

// The rumble cut, beside the ladder rather than on it: it is not a stronger click repair
// but a different fault, so it pairs with any intensity, Off included. Shared by Settings
// and the editor like the ladder above.
export function RumbleToggle({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div>
      <CheckboxRow
        testid="declick-rumble"
        checked={value}
        onChange={onChange}
        label={tr('declick.rumble')}
      />
      <p className="mt-1 pl-7 text-xs text-fg-dim">{tr('declick.rumbleHint')}</p>
    </div>
  )
}
