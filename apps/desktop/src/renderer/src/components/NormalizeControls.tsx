import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, NormalizeMode } from '../../../shared/types'
import { scrollBehavior } from '../lib/motion'
import { SegmentedControl } from './SegmentedControl'

interface Props {
  value: NormalizeConfig
  onChange: (next: NormalizeConfig) => void
  // The editor's section shows the warning itself, below its waveform, so it can
  // silence this inline copy; Settings shows it only for a default format that loses
  // the cues.
  showCueWarning?: boolean
  showHints?: boolean
}

const MODES: NormalizeMode[] = ['none', 'loudness', 'peak']

// Loudness presets cover the common delivery targets; peak presets are just a
// safe ceiling. Picking one fills the numbers, which stay editable for anything
// in between — that is the "maximum flexibility" the user asked for.
const LOUDNESS_PRESETS = [
  { id: 'streaming', lufs: -14, tp: -1 },
  { id: 'club', lufs: -9, tp: -1 },
  { id: 'broadcast', lufs: -23, tp: -1 },
]
const PEAK_PRESETS = [
  { id: 'safe', peak: -1 },
  { id: 'hot', peak: -0.1 },
]

const TYPING_PAUSE_MS = 400

function NumberField({
  testid,
  label,
  value,
  onChange,
  inputRef,
  min,
  max,
}: {
  testid: string
  label: string
  value: number
  onChange: (n: number) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  // The range ffmpeg accepts, when it has one: a value outside it is brought back in on
  // commit, so the field shows the figure the conversion will really use.
  min?: number
  max?: number
}): React.JSX.Element {
  // The field edits a text draft, not the number: every meaningful value here is
  // negative (-14 LUFS, -1 dBTP), so intermediate states ('', '-', '-0.') must
  // survive typing instead of snapping back to the last committed figure. A step of
  // the arrows is always a whole number and lands at once, so the wave preview follows
  // it; typing lands after a short pause, or on Enter or blur: typing -10 passes
  // through -1, and a per-keystroke commit sent that -1 to the plan (and to the saved
  // default) on the way.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft((d) => (Number.parseFloat(d) === value ? d : String(value)))
  }, [value])
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(pause.current), [])
  function commit(): void {
    clearTimeout(pause.current)
    const n = Number.parseFloat(draft)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max ?? n, Math.max(min ?? n, n))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  // Mid-typing, only a finished in-range figure lands: an out-of-range -4 on the way to
  // -45 waits for Enter or blur instead of turning into -5 under the user's fingers.
  function edit(e: React.ChangeEvent<HTMLInputElement>): void {
    const text = e.target.value
    setDraft(text)
    clearTimeout(pause.current)
    const n = Number.parseFloat(text)
    if (!Number.isFinite(n) || n < (min ?? n) || n > (max ?? n)) return
    if (!(e.nativeEvent instanceof InputEvent)) {
      if (n !== value) onChange(n)
      return
    }
    pause.current = setTimeout(() => {
      if (n !== value) onChange(n)
    }, TYPING_PAUSE_MS)
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <input
        ref={inputRef}
        type="number"
        data-testid={testid}
        value={draft}
        step={0.1}
        min={min}
        max={max}
        onChange={edit}
        // Enter commits here and stops: inside the Settings form it would otherwise also
        // submit, before the committed value had reached the draft being saved.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          commit()
        }}
        onBlur={commit}
        className="w-24 rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  )
}

// The normalization picker, shared by Settings (global default) and the Editor
// (per-track override). Pure controlled component: it never reaches for ffmpeg or
// settings, it just edits a NormalizeConfig.
export function NormalizeControls({
  value,
  onChange,
  showCueWarning = true,
  showHints = true,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Focus targets for the Custom chip, so picking "Custom" drops the caret straight
  // into the field the user is about to tune.
  const lufsRef = useRef<HTMLInputElement>(null)
  const peakRef = useRef<HTMLInputElement>(null)
  // Switching a mode on reveals the target fields BELOW the segmented control — at the
  // bottom of a scrolling Settings tab they land under the fold, where the scrollbar
  // moves but nothing visibly changes. Scroll the revealed block into view so the click
  // shows its result. Only on a real change: mounting with a mode already active (the
  // editor reopening a configured track) must not yank the view.
  const detailRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (value.mode !== 'none')
      detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: scrollBehavior() })
  }, [value.mode])
  // Custom pressed over a preset's numbers stays lit until another preset is picked;
  // read off the numbers alone, the preset kept the highlight and the press looked dead.
  const [customPicked, setCustomPicked] = useState(false)
  const loudnessPreset = customPicked
    ? 'custom'
    : (LOUDNESS_PRESETS.find((p) => p.lufs === value.targetLufs && p.tp === value.truePeakDb)?.id ??
      'custom')
  const peakPreset = customPicked
    ? 'custom'
    : (PEAK_PRESETS.find((p) => p.peak === value.peakDb)?.id ?? 'custom')
  // Custom carries no numbers of its own, so choosing it hands the caret to the field.
  const toField = (ref: React.RefObject<HTMLInputElement | null>): void => {
    ref.current?.focus()
    ref.current?.select()
  }
  // The mode named by its effect on the batch, which is the only fact that picks between
  // the two: same perceived loudness everywhere, or same loudest sample with the perceived
  // loudness still varying. It sits under the presets, with the preset's own line, so the
  // mode's choices read as one block instead of a line between two rows of buttons.
  const modeLine = showHints && (
    <span data-testid="normalize-mode-line">{tr(`normalize.modeLine.${value.mode}`)}</span>
  )
  return (
    <div>
      <SegmentedControl
        options={MODES}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        testidPrefix="normalize-mode"
        label={tr('normalize.title')}
        labelFor={(mode) => tr(`normalize.mode.${mode}`)}
      />
      {value.mode === 'loudness' && (
        <div ref={detailRef} className="mt-3 space-y-3">
          <SegmentedControl
            options={[...LOUDNESS_PRESETS.map((p) => p.id), 'custom']}
            value={loudnessPreset}
            onChange={(id) => {
              const preset = LOUDNESS_PRESETS.find((p) => p.id === id)
              setCustomPicked(!preset)
              if (preset) onChange({ ...value, targetLufs: preset.lufs, truePeakDb: preset.tp })
              else toField(lufsRef)
            }}
            testidPrefix="normalize-preset"
            label={tr('normalize.mode.loudness')}
            labelFor={(id) => tr(`normalize.preset.${id}`)}
          />
          <p className="text-xs text-fg-dim">
            {modeLine}
            {modeLine && ' '}
            <span data-testid="normalize-preset-hint">
              {tr(`normalize.presetHint.${loudnessPreset}`)}
            </span>
          </p>
          <div className="flex gap-4">
            <NumberField
              testid="normalize-target-lufs"
              label={tr('normalize.targetLufs')}
              min={-70}
              max={-5}
              value={value.targetLufs}
              onChange={(n) => onChange({ ...value, targetLufs: n })}
              inputRef={lufsRef}
            />
            <div>
              <NumberField
                testid="normalize-true-peak"
                label={tr('normalize.truePeak')}
                min={-9}
                max={0}
                value={value.truePeakDb}
                onChange={(n) => onChange({ ...value, truePeakDb: n })}
              />
              {/* The caption that undoes the "two targets" reading: a user watched his
                  files land under the ceiling and asked why they missed "the target". */}
              {showHints && (
                <p
                  data-testid="normalize-ceiling-caption"
                  className="mt-1 max-w-[180px] text-[10px] leading-snug text-fg-faint"
                >
                  {tr('normalize.truePeakCaption')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {value.mode === 'peak' && (
        <div ref={detailRef} className="mt-3 space-y-3">
          <SegmentedControl
            options={[...PEAK_PRESETS.map((p) => p.id), 'custom']}
            value={peakPreset}
            onChange={(id) => {
              const preset = PEAK_PRESETS.find((p) => p.id === id)
              setCustomPicked(!preset)
              if (preset) onChange({ ...value, peakDb: preset.peak })
              else toField(peakRef)
            }}
            testidPrefix="normalize-preset"
            label={tr('normalize.mode.peak')}
            labelFor={(id) => tr(`normalize.preset.${id}`)}
          />
          {modeLine && <p className="text-xs text-fg-dim">{modeLine}</p>}
          <NumberField
            testid="normalize-peak"
            label={tr('normalize.peakDb')}
            value={value.peakDb}
            onChange={(n) => onChange({ ...value, peakDb: n })}
            inputRef={peakRef}
          />
          <label className="flex cursor-pointer items-start gap-3">
            <input
              data-testid="normalize-peak-per-channel"
              type="checkbox"
              checked={value.peakPerChannel === true}
              onChange={(e) => onChange({ ...value, peakPerChannel: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr('normalize.peakPerChannel')}</span>
          </label>
        </div>
      )}
      {/* Outside both mode blocks: centring a biased capture is a correction of the
          signal, not part of how the gain is sized, so loudness and peak share the one
          box (it used to live inside peak only, which silently dropped it for loudness
          users). The hairline above draws that boundary. Hidden in none, though — with
          no normalization the pipeline never applies any filter (normalizeFilter bails
          before reading removeDcOffset), and a visible checkbox under the None tab
          promised a correction that never happened. */}
      {value.mode !== 'none' && (
        <label className="mt-3 flex cursor-pointer items-start gap-3 border-t border-[var(--color-line)] pt-3">
          <input
            data-testid="normalize-remove-dc"
            type="checkbox"
            checked={value.removeDcOffset === true}
            onChange={(e) => onChange({ ...value, removeDcOffset: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="text-sm">{tr('normalize.removeDcOffset')}</span>
        </label>
      )}

      {showCueWarning && value.mode !== 'none' && (
        <p data-testid="normalize-cue-warning" className="mt-3 text-xs text-warn">
          {tr('normalize.cueWarning')}
        </p>
      )}
    </div>
  )
}
