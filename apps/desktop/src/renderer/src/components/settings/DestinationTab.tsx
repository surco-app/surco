import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DESTINATIONS, fromDestination, toDestination } from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DestinationPicker } from '../DestinationPicker'
import { OutputFolderField } from '../OutputFolderField'
import { CueGrid } from './CueGrid'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

// Apple Music automation only exists on macOS, so the destination is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = isMacOS()

// The starting figure each answer sets. 51 ms is what the DJ who reported this arrived
// at by ear over a long session with AudioFinder, which uses the same constant; it is
// NOT a measured property of the conversion — that one is the MP3 encoder delay
// (25.06 ms) and Surco already compensates it on its own (see mp3EncoderDelay.ts).
// Treat this as a starting point the user then tunes, not as a correct value.
const CUE_DRIFT_START_MS = 51

// Negative delays a cue, positive brings it forward: shiftTraktorCues subtracts, so a
// cue heard EARLY has to move later, which is the negative one.
const CUE_DRIFT_ANSWERS = [
  {
    id: 'none',
    ms: 0,
    labelKey: 'settings.traktorCueDriftNone',
    hintKey: 'settings.traktorCueDriftNoneHint',
  },
  {
    id: 'early',
    ms: -CUE_DRIFT_START_MS,
    labelKey: 'settings.traktorCueDriftEarly',
    hintKey: 'settings.traktorCueDriftEarlyHint',
  },
  {
    id: 'late',
    ms: CUE_DRIFT_START_MS,
    labelKey: 'settings.traktorCueDriftLate',
    hintKey: 'settings.traktorCueDriftLateHint',
  },
] as const

// The sizes offered once a direction is chosen, taken from the scale the hint teaches
// rather than picked for roundness: under 20 ms the shift is barely audible and from
// 50 ms it is unmistakable, so these bracket the range where the DJ can actually hear
// what they changed. Unsigned — the answer above owns the direction, which is what lets
// one row of steps serve both "early" and "late".
const CUE_STEPS_MS = [10, 25, 50, 75] as const

// Half a beat at 128 BPM (234 ms) is where this stops being a cue adjustment: past it
// the cue is nearer the next beat than its own, and CueGrid stops drawing it too.
const CUE_FINE_MAX_MS = 120

// Which answer the stored value corresponds to, so reopening Settings shows the state
// the conversion will actually use. Any non-zero figure the user typed by hand still
// reads as its own direction rather than falling back to "no adjustment".
function driftOf(value: string): 'none' | 'early' | 'late' {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms === 0) return 'none'
  return ms < 0 ? 'early' : 'late'
}

// The typed figure restated as what the DJ will hear. A negative offset delays the cue
// (see cueShiftFor, which subtracts it), so it fires LATER — the opposite reading of the
// minus sign is the one people reach for first, which is exactly why this exists. An
// unreadable or zero value has no effect to describe.
function cueEffectKey(value: string): string {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms === 0) return 'settings.traktorCueOffsetNone'
  return ms < 0 ? 'settings.traktorCueOffsetLater' : 'settings.traktorCueOffsetEarlier'
}

interface Props {
  synced: SyncedDraft
  local: LocalDraft
  patch: PatchSynced
  onOutputDirChange: (dir: string) => void
  onChangeEngineDir: () => void
  onChangeTraktorNmlPath: () => void
  // A candidate collection.nml autodetection found — null while unresolved or once
  // traktorNmlPath is already set (see SettingsModal). Never applied on its own; the
  // user accepts it explicitly via onAcceptDetectedNmlPath.
  detectedNmlPath: string | null
  onAcceptDetectedNmlPath: () => void
}

// Where a conversion ends up: the output folder, the destination radio (folder /
// Apple Music / Engine DJ / overwrite) and Engine DJ's own fields. Split from the
// Conversion tab, which keeps everything that defines the file itself — the format
// chosen there still gates the choices here (FLAC pins the folder).
export function DestinationTab({
  synced,
  local,
  patch,
  onOutputDirChange,
  onChangeEngineDir,
  onChangeTraktorNmlPath,
  detectedNmlPath,
  onAcceptDetectedNmlPath,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The stored offset split into the two things the UI edits separately: the answer owns
  // the direction, the steps and slider own the size. Keeping them apart is what lets one
  // unsigned row of steps serve both directions without ever flipping the user's answer.
  const drift = driftOf(synced.traktorCueOffsetMs)
  const magnitude = Math.min(
    CUE_FINE_MAX_MS,
    Math.round(Math.abs(Number(synced.traktorCueOffsetMs)) || 0),
  )
  const sign = drift === 'early' ? -1 : 1
  // There is a size to set only once cues are being written at all and the DJ has said
  // which way they land. Both halves stay visible when it is false, so the panel never
  // changes shape — they just cannot be moved, and the hint below says what is missing.
  const sizingEnabled = Boolean(local.traktorNmlPath) && drift !== 'none'
  // FLAC can't go to Apple Music, so the destination is pinned to the output folder
  // while it's the format. Otherwise the stored booleans map onto the single radio choice.
  const flacOnly = synced.outputFormat === 'flac'
  const destination = toDestination(
    synced.addToAppleMusic,
    flacOnly,
    synced.overwriteOriginal,
    synced.addToEngineDj,
    synced.convertBesideOriginal,
  )
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    patch('addToAppleMusic', next.addToAppleMusic)
    patch('keepOutputCopy', next.keepOutputCopy)
    patch('overwriteOriginal', next.overwriteOriginal)
    patch('addToEngineDj', next.addToEngineDj)
    patch('convertBesideOriginal', next.convertBesideOriginal)
  }
  // The folder is a detail OF the "Output folder" choice, so it renders under that
  // radio (via the picker's details slot) instead of floating above the group like an
  // unrelated global path — under Apple Music or overwrite there is no folder copy for
  // it to describe.
  const folderDetail = (
    <OutputFolderField
      value={local.outputDir}
      onChange={onOutputDirChange}
      testid="settings-output"
    />
  )
  // Engine DJ's fields nest under its radio exactly like the output folder does — the
  // two destination details read as one pattern instead of one inline and one trailing
  // the whole group.
  const engineDetail = (
    <div>
      <SettingsLabel htmlFor="settings-engine-library" className="mb-2">
        {tr('settings.engineLibraryDir')}
      </SettingsLabel>
      <div className="flex gap-2">
        <input
          id="settings-engine-library"
          data-testid="settings-engine-library"
          value={local.engineLibraryDir}
          readOnly
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
        />
        <button
          type="button"
          onClick={onChangeEngineDir}
          className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
        >
          {tr('common.change')}
        </button>
      </div>
      <SettingsHint className="mt-2">{tr('settings.engineLibraryDirHint')}</SettingsHint>
      <SettingsLabel htmlFor="settings-engine-playlist" className="mt-4 mb-2">
        {tr('settings.engineDjPlaylist')}
      </SettingsLabel>
      <input
        id="settings-engine-playlist"
        data-testid="settings-engine-playlist"
        value={synced.engineDjPlaylist}
        onChange={(e) => patch('engineDjPlaylist', e.target.value)}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm"
      />
      <SettingsHint className="mt-2">{tr('settings.engineDjPlaylistHint')}</SettingsHint>
    </div>
  )
  return (
    <>
      <SettingsField label={tr('settings.destination')}>
        <DestinationPicker
          destinations={DESTINATIONS.filter((d) => isMac || d !== 'appleMusic')}
          value={destination}
          onChange={chooseDestination}
          flacOnly={flacOnly}
          testidPrefix="settings-destination"
          radioName="destination"
          details={{ folder: folderDetail, engineDj: engineDetail }}
        />
      </SettingsField>
      {/* Independent of the destination radio above: Traktor sync patches cue points
          into collection.nml as a side effect of conversion, wherever the file ends up —
          it isn't itself a place the converted file goes. Empty path means the feature
          is off (see settings.ts), so this is the only control that turns it on. */}
      <SettingsSection eyebrow={tr('settings.traktorSync')}>
        {/* No htmlFor: the value below is a read-only display, not a form control, so
            there is nothing for a label to focus. */}
        <SettingsLabel>{tr('settings.traktorNmlPath')}</SettingsLabel>
        <div className="mt-2 flex gap-2">
          {/* Not an input: nothing can be typed here, the path only ever changes through
              "Change". As an input it took a caret on click, and the browser then scrolled
              the text sideways to reveal the end — hiding the start of the path on top of
              the truncation already clipping the end (tabIndex={-1} did not help: it stops
              tabbing, not clicking). A plain element can't be focused or scrolled, and
              title still carries the full path for anyone who needs to read it whole. */}
          <div
            id="settings-traktor-nml"
            data-testid="settings-traktor-nml"
            title={local.traktorNmlPath}
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
          >
            {local.traktorNmlPath}
          </div>
          <button
            type="button"
            data-testid="settings-traktor-nml-change"
            onClick={onChangeTraktorNmlPath}
            className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
          >
            {tr('common.change')}
          </button>
        </div>
        <SettingsHint className="mt-2">{tr('settings.traktorNmlPathHint')}</SettingsHint>
        {/* Never applied without this explicit click — autodetection only proposes,
            it must never silently pick a version folder or write to it. */}
        {!local.traktorNmlPath && detectedNmlPath && (
          <div
            data-testid="settings-traktor-nml-detected"
            className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{detectedNmlPath}</p>
              <SettingsHint>{tr('settings.traktorNmlPathDetectedHint')}</SettingsHint>
            </div>
            <button
              type="button"
              data-testid="settings-traktor-nml-use-detected"
              onClick={onAcceptDetectedNmlPath}
              className="press shrink-0 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
            >
              {tr('settings.traktorNmlPathUseDetected')}
            </button>
          </div>
        )}
        {/* Asked as a question, not as a number: milliseconds are a unit no DJ can
            estimate, while "my cues come in early" is exactly what they hear. The answer
            picks the sign and a starting value; the figure stays visible and editable
            below for anyone who has their own. Always rendered, never conditionally
            mounted — a control that appears and disappears leaves the user unable to tell
            whether the setting exists at all; without a collection it is disabled and
            says what is missing. */}
        <div className="mt-6">
          <SettingsLabel>{tr('settings.traktorCueOffset')}</SettingsLabel>
          <p className="mt-1 text-sm text-fg-muted">{tr('settings.traktorCueDriftQuestion')}</p>
          <div className="mt-2 flex flex-col gap-0.5">
            {CUE_DRIFT_ANSWERS.map((answer) => {
              const chosen = drift === answer.id
              return (
                <button
                  key={answer.id}
                  type="button"
                  data-testid={`settings-cue-drift-${answer.id}`}
                  aria-pressed={chosen}
                  disabled={!local.traktorNmlPath}
                  onClick={() => patch('traktorCueOffsetMs', String(answer.ms))}
                  className="press flex w-full items-baseline gap-2.5 rounded-md px-1 py-1 text-left hover:bg-[var(--color-panel-2)]/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className={`size-3.5 shrink-0 self-center rounded-full border ${
                      chosen
                        ? 'border-[5px] border-[var(--color-accent)]'
                        : 'border-[var(--color-line-strong)]'
                    }`}
                  />
                  {/* One line per answer: the label carries the choice, the note trails it
                      in dim text. As bordered cards these three outweighed the
                      collection.nml field above, which is the setting that actually
                      matters in this section. */}
                  <span className="min-w-0 text-sm">
                    {tr(answer.labelKey)} <span className="text-fg-dim">{tr(answer.hintKey)}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {/* Always mounted, disabled when there is nothing to size — never unmounted.
              Rendering these only once a direction was chosen hid them in the state the
              panel opens in, so a DJ who never picks early or late could not tell the
              sizes existed; and a block that materialises under the answer reads as a UI
              changing shape rather than as a control that does not apply yet. Same reason
              the answers above are disabled instead of hidden without a collection. */}
          <div className="mt-4">
            <p className={`text-sm ${sizingEnabled ? 'text-fg-muted' : 'text-fg-dim'}`}>
              {tr('settings.traktorCueStepsLabel')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CUE_STEPS_MS.map((step) => {
                // Only a chosen direction can mark a step: at "where I left them" the
                // stored 0 matches no step, and lighting one up would claim a size for an
                // adjustment that isn't happening.
                const chosen = sizingEnabled && magnitude === step
                return (
                  <button
                    key={step}
                    type="button"
                    data-testid={`settings-cue-step-${step}`}
                    aria-pressed={chosen}
                    disabled={!sizingEnabled}
                    onClick={() => patch('traktorCueOffsetMs', String(sign * step))}
                    className={`press rounded-lg border px-3 py-1.5 text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-50 ${
                      chosen
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-fg'
                        : 'border-[var(--color-line-strong)] text-fg-muted enabled:hover:bg-[var(--color-panel-2)]/40'
                    }`}
                  >
                    {step} ms
                  </button>
                )
              })}
            </div>
            {/* The extremes of the row named, so the numbers carry the thing the DJ can
                hear. Naming every step would repeat the same idea four times. */}
            <div className="mt-1.5 flex justify-between text-xs text-fg-dim">
              <span>{tr('settings.traktorCueStepBarely')}</span>
              <span>{tr('settings.traktorCueStepClear')}</span>
            </div>

            {/* The steps are shortcuts, not the range. This is what keeps every value
                reachable now that the figure cannot be typed — the reporter's own 51 ms
                is not on the row, and rounding him to 50 would be changing his setting.
                Unsigned like the steps: the slider sizes, the answer directs. */}
            <div className="mt-3 flex items-center gap-3">
              <input
                id="settings-cue-fine"
                data-testid="settings-cue-fine"
                type="range"
                min={0}
                max={CUE_FINE_MAX_MS}
                step={1}
                disabled={!sizingEnabled}
                value={magnitude}
                aria-label={tr('settings.traktorCueFineLabel')}
                onChange={(e) => patch('traktorCueOffsetMs', String(sign * Number(e.target.value)))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-line-strong)] accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span
                className={`w-14 shrink-0 text-right text-sm tabular-nums ${
                  sizingEnabled ? 'text-fg-muted' : 'text-fg-dim'
                }`}
              >
                {magnitude} ms
              </span>
            </div>
          </div>
          {/* The stored figure restated as what the DJ will hear: the sign is arithmetic,
              this is the same thing in the words the answers above use. */}
          <p data-testid="settings-cue-offset-effect" className="mt-3 text-sm text-fg-muted">
            {tr(cueEffectKey(synced.traktorCueOffsetMs), {
              ms: Math.abs(Number(synced.traktorCueOffsetMs) || 0),
            })}
          </p>
          {/* The same value again, against a beat: milliseconds only mean something once
              you can see how much of a beat they are. */}
          <CueGrid offsetMs={Number(synced.traktorCueOffsetMs)} />
          <SettingsHint className="mt-2">
            {local.traktorNmlPath
              ? tr('settings.traktorCueOffsetHint')
              : tr('settings.traktorCueOffsetIdle')}
          </SettingsHint>
        </div>
      </SettingsSection>
    </>
  )
}
