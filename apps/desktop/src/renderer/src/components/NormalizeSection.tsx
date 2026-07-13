import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { formatDb } from '../lib/quality'
import type { TrackItem } from '../types'
import { NormalizeControls } from './NormalizeControls'
import { SectionHeader } from './SectionHeader'
import { WaveformCompare, WaveformSolo } from './WaveformCompare'

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
  // The dB line the strips mark in red: the active mode's own ceiling, so the marks
  // show exactly where the conversion will limit. With normalization off there is no
  // line at all — the strips fall back to the decoder's true-clipping flags, the
  // per-sample scan that matches Audacity's marks (an envelope threshold cannot:
  // hot masters ride the ceiling for whole sections without ever clipping).
  const clipDb =
    value.mode === 'loudness' ? value.truePeakDb : value.mode === 'peak' ? value.peakDb : undefined
  // The pair lands at the bottom of a scrolling editor: when it appears because a
  // conversion just finished (not on mount — flipping back to a done track must not
  // yank the view), scroll it into view or most users never see it. Same reveal
  // pattern as NormalizeControls' mode switch.
  const compareRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  // The source's measured loudness, worn on the header like the quality section's
  // verdict pill — the one convention for analysis results. Shares the per-path
  // cache the strips' legends read, and the same open-gating as the wave decode,
  // so a folded section stays unanalysed but keeps the pill once known.
  const { data: measured } = useTrackLoudness(item.inputPath, !isMulti && open && settled)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (compare) compareRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [compare])
  return (
    <div data-testid="editor-normalize" className="mt-6 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        sectionId="normalize"
        title={tr('normalize.title')}
        open={open}
        onToggle={onToggle}
        // The badge names the active mode; the summary carries what it omits — the
        // figures the conversion will target — and states "None" when off, so the
        // folded header never reads blank.
        summary={
          value.mode === 'loudness'
            ? `${value.targetLufs} LUFS · ${value.truePeakDb} dBTP`
            : value.mode === 'peak'
              ? `${value.peakDb} dB`
              : tr('normalize.mode.none')
        }
        summaryTestId="normalize-summary"
        right={
          <span className="flex shrink-0 items-center gap-1.5">
            {/* The measurement pill stays up open or folded — it is a fact about
                the file, not a control state, and the body never repeats it as
                figures this compact. */}
            {measured && (
              <span
                data-testid="normalize-measured-pill"
                className="whitespace-nowrap rounded-full bg-[var(--color-panel-2)] px-2.5 py-1 text-xs font-medium tabular-nums text-fg-muted"
              >
                {`${formatDb(measured.integratedLufs)} LUFS · ${formatDb(measured.truePeakDb)} dBTP`}
              </span>
            )}
            {/* The mode badge only while folded: open, the segmented control right
                below says the same thing. */}
            {value.mode !== 'none' && !open && (
              <span
                data-testid="normalize-active-badge"
                className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
              >
                {tr(`normalize.mode.${value.mode}`)}
              </span>
            )}
          </span>
        }
      />
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-xs text-fg-dim">{tr('normalize.editorHint')}</p>
          {/* The cue warning renders once, below the wave: inline it sat between the
              dials and the preview, right where the eye travels while tuning. */}
          <NormalizeControls value={value} onChange={onChange} showCueWarning={false} />
          {!isMulti && !compare && (
            <WaveformSolo inputPath={item.inputPath} enabled={settled} clipDb={clipDb} normalize={value} />
          )}
          {compare && item.outputPath && (
            <div ref={compareRef}>
              <WaveformCompare
                inputPath={item.inputPath}
                outputPath={item.outputPath}
                enabled={settled}
                clipDb={clipDb}
              />
            </div>
          )}
          {value.mode !== 'none' && (
            <p data-testid="normalize-cue-warning" className="mt-3 text-xs text-warn">
              {tr('normalize.cueWarning')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
