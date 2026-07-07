import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DESTINATIONS, fromDestination, toDestination } from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DestinationPicker } from '../DestinationPicker'

// Apple Music automation only exists on macOS, so the destination is meaningless on
// other platforms where a track simply finishes in the output folder.
const isMac = isMacOS()

interface Props {
  synced: SyncedDraft
  local: LocalDraft
  patch: PatchSynced
  onChangeDir: () => void
  onChangeEngineDir: () => void
}

// Where a conversion ends up: the output folder, the destination radio (folder /
// Apple Music / Engine DJ / overwrite) and Engine DJ's own fields. Split from the
// Conversion tab, which keeps everything that defines the file itself — the format
// chosen there still gates the choices here (FLAC pins the folder).
export function DestinationTab({
  synced,
  local,
  patch,
  onChangeDir,
  onChangeEngineDir,
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
  )
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    patch('addToAppleMusic', next.addToAppleMusic)
    patch('keepOutputCopy', next.keepOutputCopy)
    patch('overwriteOriginal', next.overwriteOriginal)
    patch('addToEngineDj', next.addToEngineDj)
  }
  return (
    <>
      <label htmlFor="settings-output" className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.outputDir')}
      </label>
      <div className="mb-5 flex gap-2">
        <input
          id="settings-output"
          data-testid="settings-output"
          value={local.outputDir}
          readOnly
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
        />
        <button
          type="button"
          onClick={onChangeDir}
          className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
        >
          {tr('common.change')}
        </button>
      </div>

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.destination')}
      </span>
      <DestinationPicker
        destinations={DESTINATIONS.filter((d) => isMac || d !== 'appleMusic')}
        value={destination}
        onChange={chooseDestination}
        flacOnly={flacOnly}
        testidPrefix="settings-destination"
        radioName="destination"
      />
      {isMac && flacOnly && (
        <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.appleMusicFlacNote')}</p>
      )}
      {destination === 'engineDj' && (
        <>
          <label
            htmlFor="settings-engine-library"
            className="mt-3 mb-1.5 block text-sm font-medium text-fg-muted"
          >
            {tr('settings.engineLibraryDir')}
          </label>
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
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.engineLibraryDirHint')}</p>
          <label
            htmlFor="settings-engine-playlist"
            className="mt-3 mb-1.5 block text-sm font-medium text-fg-muted"
          >
            {tr('settings.engineDjPlaylist')}
          </label>
          <input
            id="settings-engine-playlist"
            data-testid="settings-engine-playlist"
            value={synced.engineDjPlaylist}
            onChange={(e) => patch('engineDjPlaylist', e.target.value)}
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm"
          />
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.engineDjPlaylistHint')}</p>
        </>
      )}
    </>
  )
}
