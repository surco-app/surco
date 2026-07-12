import type React from 'react'
import { useTranslation } from 'react-i18next'
import {
  DECLICK_MAX_SENSITIVITY,
  DECLICK_MIN_SENSITIVITY,
  declickFilter,
} from '../../../shared/declick'
import type { DeclickConfig, DeclickMode } from '../../../shared/types'
import { SegmentedControl } from './SegmentedControl'

interface Props {
  value: DeclickConfig
  onChange: (next: DeclickConfig) => void
}

const MODES: readonly DeclickMode[] = ['off', 'standard', 'strong']

// The click-repair picker, shared by Settings (global default) and the Editor
// (per-track override) exactly like NormalizeControls. Pure controlled component:
// the mode picks the burst fusion preset, and the sensitivity slider covers the one
// knob that is safe in every position — it only ever raises adeclick's detection
// threshold above its default (lowering it is the measured hang zone, so the
// slider's ceiling IS the filter's default). The exact filter string renders below
// the controls, so what gets applied is never a mystery.
export function DeclickControls({ value, onChange }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const filter = declickFilter(value)
  return (
    <div>
      <SegmentedControl
        options={MODES}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        testidPrefix="declick-mode"
        labelFor={(id) => tr(`declick.mode.${id}`)}
      />
      {value.mode !== 'off' && (
        <>
          <p data-testid="declick-mode-hint" className="mt-2 text-xs text-fg-dim">
            {tr(`declick.modeHint.${value.mode}`)}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <label htmlFor="declick-sensitivity" className="text-xs text-fg-muted">
              {tr('declick.sensitivity')}
            </label>
            <input
              id="declick-sensitivity"
              data-testid="declick-sensitivity"
              type="range"
              min={DECLICK_MIN_SENSITIVITY}
              max={DECLICK_MAX_SENSITIVITY}
              step={1}
              value={value.sensitivity}
              onChange={(e) => onChange({ ...value, sensitivity: Number(e.target.value) })}
              className="player-volume-range h-1 w-32 cursor-pointer"
            />
            <span className="text-xs tabular-nums text-fg-muted">
              {value.sensitivity}/{DECLICK_MAX_SENSITIVITY}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-fg-dim">{tr('declick.sensitivityHint')}</p>
          {/* The exact ffmpeg stage the conversion will run — built by the same
              shared function main uses, so it can never lie. */}
          {filter && (
            <p data-testid="declick-applied" className="mt-2 font-mono text-[11px] text-fg-faint">
              {tr('declick.applied')} {filter}
            </p>
          )}
        </>
      )}
    </div>
  )
}
