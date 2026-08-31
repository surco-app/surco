import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizeConfig, NormalizeMode } from '../../../shared/types'
import { SegmentedControl } from './SegmentedControl'

interface Props {
  value: NormalizeConfig
  onChange: (next: NormalizeConfig) => void
  // The editor's section shows the warning itself, below its waveform, so it can
  // silence this inline copy; Settings keeps the default.
  showCueWarning?: boolean
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

function NumberField({
  testid,
  label,
  value,
  onChange,
  inputRef,
}: {
  testid: string
  label: string
  value: number
  onChange: (n: number) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  // The field edits a text draft, not the number: every meaningful value here is
  // negative (-14 LUFS, -1 dBTP), so intermediate states ('', '-', '-0.') must
  // survive typing instead of snapping back to the last committed figure. A finite
  // parse commits immediately; an abandoned draft falls back on blur.
  const [draft, setDraft] = useState(String(value))
  // External writes (preset buttons, the per-track reseed) refresh the draft — but
  // not while the draft already parses to the committed value, or committing '-9.'
  // mid-typing would erase the trailing separator under the cursor.
  useEffect(() => {
    setDraft((d) => (Number.parseFloat(d) === value ? d : String(value)))
  }, [value])
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <input
        ref={inputRef}
        type="number"
        data-testid={testid}
        value={draft}
        step={0.1}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number.parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setDraft(String(value))}
        className="w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
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
      detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [value.mode])
  const loudnessIsCustom = !LOUDNESS_PRESETS.some(
    (p) => p.lufs === value.targetLufs && p.tp === value.truePeakDb,
  )
  const peakIsCustom = !PEAK_PRESETS.some((p) => p.peak === value.peakDb)
  const customChipClass = (active: boolean): string =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
        : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
    }`
  return (
    <div>
      <SegmentedControl
        options={MODES}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        testidPrefix="normalize-mode"
        labelFor={(mode) => tr(`normalize.mode.${mode}`)}
      />
      {/* The mode named by its effect on the batch, which is the only fact that picks
          between the two: same perceived loudness everywhere, or same loudest sample
          with the perceived loudness still varying. Mechanisms stay out of it. */}
      {value.mode !== 'none' && (
        <p data-testid="normalize-mode-line" className="mt-2 text-xs text-fg-dim">
          {tr(`normalize.modeLine.${value.mode}`)}
        </p>
      )}

      {value.mode === 'loudness' && (
        <div ref={detailRef} className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {LOUDNESS_PRESETS.map((p) => {
              const active = value.targetLufs === p.lufs && value.truePeakDb === p.tp
              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`normalize-preset-${p.id}`}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, targetLufs: p.lufs, truePeakDb: p.tp })}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
                  }`}
                >
                  {tr(`normalize.preset.${p.id}`)}
                </button>
              )
            })}
            <button
              type="button"
              data-testid="normalize-preset-custom"
              aria-pressed={loudnessIsCustom}
              onClick={() => lufsRef.current?.select()}
              className={customChipClass(loudnessIsCustom)}
            >
              {tr('normalize.preset.custom')}
            </button>
          </div>
          <p data-testid="normalize-preset-hint" className="text-xs text-fg-dim">
            {tr(
              `normalize.presetHint.${
                loudnessIsCustom
                  ? 'custom'
                  : (LOUDNESS_PRESETS.find(
                      (p) => p.lufs === value.targetLufs && p.tp === value.truePeakDb,
                    )?.id ?? 'custom')
              }`,
            )}
          </p>
          <div className="flex gap-4">
            <NumberField
              testid="normalize-target-lufs"
              label={tr('normalize.targetLufs')}
              value={value.targetLufs}
              onChange={(n) => onChange({ ...value, targetLufs: n })}
              inputRef={lufsRef}
            />
            <div>
              <NumberField
                testid="normalize-true-peak"
                label={tr('normalize.truePeak')}
                value={value.truePeakDb}
                onChange={(n) => onChange({ ...value, truePeakDb: n })}
              />
              {/* The caption that undoes the "two targets" reading: a user watched his
                  files land under the ceiling and asked why they missed "the target". */}
              <p
                data-testid="normalize-ceiling-caption"
                className="mt-1 max-w-[180px] text-[10px] leading-snug text-fg-faint"
              >
                {tr('normalize.truePeakCaption')}
              </p>
            </div>
          </div>
        </div>
      )}

      {value.mode === 'peak' && (
        <div ref={detailRef} className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PEAK_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`normalize-preset-${p.id}`}
                aria-pressed={value.peakDb === p.peak}
                onClick={() => onChange({ ...value, peakDb: p.peak })}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  value.peakDb === p.peak
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
                }`}
              >
                {tr(`normalize.preset.${p.id}`)}
              </button>
            ))}
            <button
              type="button"
              data-testid="normalize-preset-custom"
              aria-pressed={peakIsCustom}
              onClick={() => peakRef.current?.select()}
              className={customChipClass(peakIsCustom)}
            >
              {tr('normalize.preset.custom')}
            </button>
          </div>
          <NumberField
            testid="normalize-peak"
            label={tr('normalize.peakDb')}
            value={value.peakDb}
            onChange={(n) => onChange({ ...value, peakDb: n })}
            inputRef={peakRef}
          />
          <label className="flex cursor-pointer items-center gap-3">
            <input
              data-testid="normalize-peak-per-channel"
              type="checkbox"
              checked={value.peakPerChannel === true}
              onChange={(e) => onChange({ ...value, peakPerChannel: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
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
        <label className="mt-3 flex cursor-pointer items-center gap-3 border-t border-[var(--color-line)] pt-3">
          <input
            data-testid="normalize-remove-dc"
            type="checkbox"
            checked={value.removeDcOffset === true}
            onChange={(e) => onChange({ ...value, removeDcOffset: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">{tr('normalize.removeDcOffset')}</span>
        </label>
      )}

      {showCueWarning && value.mode !== 'none' && (
        <p className="mt-3 text-xs text-warn">{tr('normalize.cueWarning')}</p>
      )}
    </div>
  )
}
