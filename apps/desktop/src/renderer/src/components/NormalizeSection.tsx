import { TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig } from '../../../shared/types'
import { SELECTION_SETTLE_MS, useSettled } from '../hooks/useSettled'
import { useTrackLoudness } from '../hooks/useTrackLoudness'

import type { TrackItem } from '../types'
import { NormalizeControls } from './NormalizeControls'
import { NormalizePlan } from './NormalizePlan'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'
import { Tooltip } from './Tooltip'
import { WaveformCompare, WaveformSolo } from './WaveformCompare'

interface Props {
  value: NormalizeConfig
  open: boolean
  onToggle: () => void
  onChange: (config: NormalizeConfig) => void
  item: TrackItem
  // How many tracks the dials below will apply to. The batch passes ONE override to
  // every selected track (see normalizeForJob), so with a selection open these controls
  // are not this track's loudness — they are all of them at once, and the section has to
  // say so. A count rather than a boolean because the number is the warning.
  selectedCount: number
  // Opens the loudness metric help ("What do these mean?"): the ranges and the
  // fixable/not-fixable notes lived only behind Quality's readout ⓘ, unreachable from
  // the section whose dials those metrics govern.
  onShowHelp: () => void
  showHints?: boolean
}

// The per-track normalization override, with the active mode badged on the header so
// a folded section still shows that the convert will normalize.
export function NormalizeSection({
  value,
  open,
  onToggle,
  onChange,
  item,
  selectedCount,
  onShowHelp,
  showHints = true,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The waveform is the one full-length decode, so it waits for the selection to
  // rest before analyzing — same pacing as the quality section's loudness pass.
  const settled = useSettled(SELECTION_SETTLE_MS)
  // The before/after pair proves what these controls did, so it lives under them —
  // but only once there IS an after, never for an in-place export (the rewritten
  // source leaves no honest "before" to draw), and never in multi-select, where
  // `item` is just the anchor of the selection.
  const isMulti = selectedCount > 1
  const compare = !isMulti && item.outputPath && item.outputPath !== item.inputPath
  // The staged trim as head/tail fractions, to dim the dropped audio over the
  // wave. Off item.duration (the read-once track length) — WaveformSolo decodes
  // its own wave, so there is no strip duration to reach here.
  const trimShade =
    item.trim && item.duration
      ? {
          startFrac: Math.max(0, (item.trim.startSec ?? 0) / item.duration),
          endFrac: Math.max(
            0,
            (item.duration - (item.trim.endSec ?? item.duration)) / item.duration,
          ),
        }
      : undefined
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
  // The plan card reads the same measurement the waveform legend uses (one shared
  // query, so no second decode) and only for a single selected track: in multi the
  // anchor's figures would masquerade as the batch's.
  const { data: planLoudness } = useTrackLoudness(
    item.inputPath,
    settled && !isMulti && showHints && value.mode !== 'none',
  )
  const compareRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (compare) compareRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [compare])
  return (
    <div data-testid="editor-normalize" className="mt-5 border-t border-[var(--color-line)] pt-5">
      <SectionHeader
        title={tr('normalize.title')}
        open={open}
        onToggle={onToggle}
        // A wave-work section, so it earns the maximize toggle like Trim: the
        // before/after preview is worth the whole window when tuning the target.
        sectionId="normalize"
        maximizable
        // The badge names the active mode; the summary carries what it omits — the
        // figures the conversion will target — and states "None" when off, so the
        // folded header never reads blank.
        help={tr('normalize.editorHint')}
        onHelp={onShowHelp}
        summary={
          value.mode === 'loudness'
            ? `${value.targetLufs} LUFS · ${value.truePeakDb} dBTP`
            : value.mode === 'peak'
              ? `${value.peakDb} dB`
              : tr('normalize.mode.none')
        }
        summaryTestId="normalize-summary"
        // Only the "None" state recedes; an active target is a live figure worth reading.
        summaryMuted={value.mode === 'none'}
        right={
          <span className="flex shrink-0 items-center gap-1.5">
            {/* No measurement pill here. It used to ride alongside, justified as "the body
                never repeats it as figures this compact" — no longer true: the estimate
                below opens with the same "Now -21.8 LUFS · -18.1 dBTP", and the Quality
                section states the same two figures graded by colour. Worse, it was
                typographically identical to the summary beside it (same template, same
                units, same tabular-nums), so the header read as one figure printed twice
                with nothing saying which was the target and which the measurement — while
                eating 164px of a 241px header and truncating the target to "No…".
                Trim hit the same collision and made the two mutually exclusive
                (TrimSection.tsx); this is that same fix. */}
            {/* The mode badge only while folded: open, the segmented control right
                below says the same thing. */}
            {value.mode !== 'none' && !open && (
              <SectionPill tone="accent" testid="normalize-active-badge">
                {tr(`normalize.mode.${value.mode}`)}
              </SectionPill>
            )}
          </span>
        }
      />
      <SectionBody open={open}>
        <div className="mt-4">
          {/* Above the dials, not below: the point is to be read BEFORE they are
              touched. Without it the controls look identical to the single-track case
              while the batch applies one shared value to every selected track. */}
          {isMulti && (
            <p data-testid="normalize-scope" className="mb-3 text-xs text-fg-dim">
              {tr('normalize.appliesToSelection', { count: selectedCount })}
            </p>
          )}
          {/* The cue warning renders once, below the wave: inline it sat between the
              dials and the preview, right where the eye travels while tuning. */}
          <NormalizeControls
            value={value}
            onChange={onChange}
            showCueWarning={false}
            showHints={showHints}
          />
          {!isMulti && showHints && <NormalizePlan normalize={value} loudness={planLoudness} />}
          {!isMulti && !compare && (
            <WaveformSolo
              inputPath={item.inputPath}
              enabled={settled}
              clipDb={clipDb}
              normalize={value}
              trimShade={trimShade}
            />
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
            <p
              data-testid="normalize-cue-warning"
              className="relative mt-2 inline-flex items-center gap-1.5 text-[10px] text-warn"
            >
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
              {tr('normalize.cueWarningShort')}
              <Tooltip label={tr('normalize.cueWarning')} />
            </p>
          )}
        </div>
      </SectionBody>
    </div>
  )
}
