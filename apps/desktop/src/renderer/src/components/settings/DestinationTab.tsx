import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DESTINATIONS, fromDestination, toDestination } from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DestinationPicker } from '../DestinationPicker'
import { OutputFolderField } from '../OutputFolderField'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

// Apple Music automation only exists on macOS, so the destination is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = isMacOS()

// The row, signed and centred on zero. The sizes come from the scale the hint teaches
// rather than from roundness: under 20 ms the shift is barely audible and from 50 ms it
// is unmistakable, so ±25 and ±50 bracket the range where a DJ can hear what they
// changed. Negative delays a cue, positive brings it forward — shiftTraktorCues
// subtracts, so a cue heard EARLY has to move later, which is the negative one.
const CUE_PRESETS_MS = [-50, -25, 0, 25, 50] as const

// Half a beat at 128 BPM (234 ms) is where this stops being a cue adjustment: past it the
// cue is nearer the next beat than its own. The slider reaches further than the presets
// so a value like the reporter's 51 ms is not the edge of the range.
const CUE_FINE_MAX_MS = 120

// An explicit plus is what makes the row read as a direction rather than a list of sizes;
// the minus is already there. Zero is labelled in words instead, so it never renders "+0".
function formatSigned(ms: number): string {
  return `${ms > 0 ? '+' : ''}${ms} ms`
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
  // One signed number drives both controls, clamped to what the slider can represent so a
  // stored value from an older build cannot push its thumb off the track.
  const stored = Math.max(
    -CUE_FINE_MAX_MS,
    Math.min(CUE_FINE_MAX_MS, Math.round(Number(synced.traktorCueOffsetMs)) || 0),
  )
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
        {/* One signed row, not a question plus a size. Splitting the sign from the
            magnitude cost four controls for one number — a question to pick the
            direction, an unsigned row to pick the size, a slider, and a sentence to read
            the result back — and made the least-used setting in Output the largest. A
            button labelled "-25 ms" carries the whole decision, and "No adjustment" is
            the middle of the row rather than an answer of its own.

            Always rendered, never conditionally mounted: a control that appears and
            disappears leaves the user unable to tell whether the setting exists at all.
            Without a collection it is disabled and the hint says what is missing. */}
        <div className="mt-6">
          <SettingsLabel>{tr('settings.traktorCueOffset')}</SettingsLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CUE_PRESETS_MS.map((preset) => {
              const chosen = stored === preset
              return (
                <button
                  key={preset}
                  type="button"
                  data-testid={`settings-cue-preset-${preset}`}
                  aria-pressed={chosen}
                  disabled={!local.traktorNmlPath}
                  onClick={() => patch('traktorCueOffsetMs', String(preset))}
                  className={`press rounded-lg border px-3 py-1.5 text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-50 ${
                    chosen
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-fg'
                      : 'border-[var(--color-line-strong)] text-fg-muted enabled:hover:bg-[var(--color-panel-2)]/40'
                  }`}
                >
                  {preset === 0 ? tr('settings.traktorCueNoAdjust') : formatSigned(preset)}
                </button>
              )
            })}
          </div>

          {/* The presets are shortcuts, not the range: the reporter arrived at 51 ms by
              ear and no row of round numbers contains it. Signed like the presets, so the
              slider needs no direction of its own. */}
          <div className="mt-3 flex items-center gap-3">
            <input
              id="settings-cue-fine"
              data-testid="settings-cue-fine"
              type="range"
              min={-CUE_FINE_MAX_MS}
              max={CUE_FINE_MAX_MS}
              step={1}
              disabled={!local.traktorNmlPath}
              value={stored}
              aria-label={tr('settings.traktorCueFineLabel')}
              onChange={(e) => patch('traktorCueOffsetMs', e.target.value)}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-line-strong)] accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span
              className={`w-16 shrink-0 text-right text-sm tabular-nums ${
                local.traktorNmlPath ? 'text-fg-muted' : 'text-fg-dim'
              }`}
            >
              {stored === 0 ? '0 ms' : formatSigned(stored)}
            </span>
          </div>
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
