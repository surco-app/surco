import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { DeclickMode, NoiseMode } from '../../../shared/types'
import { SectionSubhead } from './SectionSubhead'
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
      <SectionSubhead className="mb-1.5">{tr('declick.clicksLabel')}</SectionSubhead>
      <SegmentedControl
        options={MODES}
        value={value}
        onChange={onChange}
        testidPrefix="declick-mode"
        compact
        label={tr('declick.clicksLabel')}
        labelFor={(id) => tr(`declick.mode.${id}`)}
      />
      {value !== 'off' && (
        <p data-testid="declick-mode-hint" className="mt-2 w-0 min-w-full text-xs text-fg-dim">
          {tr(`declick.modeHint.${value}`)}
        </p>
      )}
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
        compact
        label={tr('declick.noiseLabel')}
        labelFor={(id) => tr(`declick.noiseMode.${id}`)}
      />
      <p data-testid="declick-noise-hint" className="mt-2 w-0 min-w-full text-xs text-fg-dim">
        {tr(`declick.noiseHint.${value}`)}
      </p>
    </div>
  )
}
