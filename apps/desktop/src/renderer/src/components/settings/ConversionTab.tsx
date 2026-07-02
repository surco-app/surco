import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../../shared/types'
import { DESTINATIONS, fromDestination, toDestination } from '../../lib/destination'
import { isMacOS } from '../../lib/platform'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DestinationPicker } from '../DestinationPicker'
import { NormalizeControls } from '../NormalizeControls'
import { SegmentedControl } from '../SegmentedControl'

const FORMATS: OutputFormat[] = ['aiff', 'alac', 'mp3', 'wav', 'flac']

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

export function ConversionTab({
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
    synced.keepOutputCopy,
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
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-dim">
        {tr('settings.outputSection')}
      </p>

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
        {tr('settings.outputFormat')}
      </span>
      <SegmentedControl
        options={FORMATS}
        value={synced.outputFormat}
        onChange={(id) => patch('outputFormat', id)}
        testidPrefix="settings-format"
        labelFor={(id) => tr(`settings.formats.${id}`)}
      />
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.outputFormatHint')}</p>

      {/* Contextual like the FLAC note: the encoder choice only matters while MP3 is
          the pick, though it applies to every MP3 export (the editor's ad-hoc ones too). */}
      {synced.outputFormat === 'mp3' && (
        <>
          <span className="mb-1.5 block text-sm font-medium text-fg-muted">
            {tr('settings.mp3Quality')}
          </span>
          <SegmentedControl
            options={['320', 'v0'] as const}
            value={synced.mp3Quality}
            onChange={(id) => patch('mp3Quality', id)}
            testidPrefix="settings-mp3-quality"
            labelFor={(id) => tr(`settings.mp3Qualities.${id}`)}
          />
          <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.mp3QualityHint')}</p>
        </>
      )}

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.destination')}
      </span>
      <DestinationPicker
        destinations={DESTINATIONS.filter((d) => isMac || (d !== 'appleMusic' && d !== 'both'))}
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
        </>
      )}

      <p className="mt-5 mb-1.5 border-t border-[var(--color-line)] pt-5 text-sm font-medium text-fg-muted">
        {tr('normalize.title')}
      </p>
      <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
      <NormalizeControls value={synced.normalize} onChange={(n) => patch('normalize', n)} />
    </>
  )
}
