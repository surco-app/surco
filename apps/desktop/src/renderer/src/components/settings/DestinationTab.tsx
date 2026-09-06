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
        <SettingsLabel htmlFor="settings-traktor-nml">
          {tr('settings.traktorNmlPath')}
        </SettingsLabel>
        <div className="mt-2 flex gap-2">
          <input
            id="settings-traktor-nml"
            data-testid="settings-traktor-nml"
            value={local.traktorNmlPath}
            readOnly
            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
          />
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
        {/* Only once a collection is set: with the sync off the number changes nothing,
            and an unexplained millisecond box is an invitation to type something into it.
            The hint carries the whole explanation rather than a tooltip per control —
            what it is, that 0 is correct, and the one symptom that justifies moving it. */}
        {local.traktorNmlPath && (
          <div className="mt-6">
            <SettingsLabel htmlFor="settings-traktor-cue-offset">
              {tr('settings.traktorCueOffset')}
            </SettingsLabel>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="settings-traktor-cue-offset"
                data-testid="settings-traktor-cue-offset"
                type="number"
                step={1}
                value={synced.traktorCueOffsetMs}
                onChange={(e) => patch('traktorCueOffsetMs', e.target.value)}
                // A blank or non-numeric box means "no adjustment", and saying so on blur
                // beats storing something the conversion would have to guess about.
                onBlur={() => {
                  if (!Number.isFinite(Number(synced.traktorCueOffsetMs))) {
                    patch('traktorCueOffsetMs', '0')
                  }
                }}
                className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-sm text-fg-dim">{tr('settings.traktorCueOffsetUnit')}</span>
            </div>
            <SettingsHint className="mt-2">{tr('settings.traktorCueOffsetHint')}</SettingsHint>
          </div>
        )}
      </SettingsSection>
    </>
  )
}
