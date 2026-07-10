import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import type { TrackItem } from '../types'
import { NormalizeControls } from './NormalizeControls'
import { SectionHeader } from './SectionHeader'
import { WaveformCompare } from './WaveformCompare'

interface Props {
  value: NormalizeConfig
  open: boolean
  onToggle: () => void
  onChange: (config: NormalizeConfig) => void
  item: TrackItem
  isMulti: boolean
}

// The per-track normalization override, with the active mode badged on the header so
// a folded section still shows that the convert will normalize.
export function NormalizeSection({
  value,
  open,
  onToggle,
  onChange,
  item,
  isMulti,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform is the one full-length decode, so it waits for the selection to
  // rest before analyzing — same pacing as the quality section's loudness pass.
  const settled = useSettled(SELECTION_SETTLE_MS)
  // The before/after pair proves what these controls did, so it lives under them —
  // but only once there IS an after, never for an in-place export (the rewritten
  // source leaves no honest "before" to draw), and never in multi-select, where
  // `item` is just the anchor of the selection.
  const compare = !isMulti && item.outputPath && item.outputPath !== item.inputPath
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
          {compare && item.outputPath && (
            <WaveformCompare
              inputPath={item.inputPath}
              outputPath={item.outputPath}
              enabled={settled}
            />
          )}
        </div>
      )}
    </div>
  )
}
