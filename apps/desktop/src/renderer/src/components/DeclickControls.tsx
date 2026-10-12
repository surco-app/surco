import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode, NoiseMode } from '../../../shared/types'
import { SectionSubhead } from './SectionSubhead'
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
      <SectionSubhead className="mb-1.5">{tr('declick.clicksLabel')}</SectionSubhead>
      <SegmentedControl
        options={MODES}
        value={value}
        onChange={onChange}
        testidPrefix="declick-mode"
        label={tr('declick.clicksLabel')}
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

const NOISE_MODES: readonly NoiseMode[] = ['off', 'soft', 'medium', 'strong']

// The background-noise ladder, built like the click one above so the two read as one
// family: the same steps, the same place for the hint. Off states what the noise is,
// since that is the moment someone is deciding whether they have it.
export function NoiseControls({
  value,
  onChange,
}: {
  value: NoiseMode
  onChange: (next: NoiseMode) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div>
      <SectionSubhead className="mb-1.5">{tr('declick.noiseLabel')}</SectionSubhead>
      <SegmentedControl
        options={NOISE_MODES}
        value={value}
        onChange={onChange}
        testidPrefix="declick-noise"
        label={tr('declick.noiseLabel')}
        labelFor={(id) => tr(`declick.noiseMode.${id}`)}
      />
      <p data-testid="declick-noise-hint" className="mt-2 text-xs text-fg-dim">
        {tr(`declick.noiseHint.${value}`)}
      </p>
    </div>
  )
}
