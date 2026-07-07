import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../../shared/types'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { NormalizeControls } from '../NormalizeControls'
import { SegmentedControl } from '../SegmentedControl'

const FORMATS: OutputFormat[] = ['aiff', 'alac', 'mp3', 'wav', 'flac']

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

// Everything that defines the converted file itself: format, the per-format quality
// knobs and loudness normalization. Where the file ends up (folder, Apple Music,
// Engine DJ) lives in the Destination tab.
export function ConversionTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <>
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
            options={['320', '256', '192', '160', '128', 'v0', 'v2'] as const}
            value={synced.mp3Quality}
            onChange={(id) => patch('mp3Quality', id)}
            testidPrefix="settings-mp3-quality"
            labelFor={(id) => tr(`settings.mp3Qualities.${id}`)}
          />
          <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.mp3QualityHint')}</p>
        </>
      )}

      {/* Bit depth shapes the PCM/FLAC/ALAC encoders; LAME has no bit depth, so under
          MP3 the control would read as a knob that does nothing. */}
      {synced.outputFormat !== 'mp3' && (
        <>
          <span className="mb-1.5 block text-sm font-medium text-fg-muted">
            {tr('settings.bitDepth')}
          </span>
          <SegmentedControl
            options={['source', '16', '24'] as const}
            value={synced.outputBitDepth}
            onChange={(id) => patch('outputBitDepth', id)}
            testidPrefix="settings-bit-depth"
            labelFor={(id) => tr(`settings.bitDepths.${id}`)}
          />
          <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.bitDepthHint')}</p>
        </>
      )}

      <span className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.sampleRate')}
      </span>
      <SegmentedControl
        options={['source', '44100', '48000'] as const}
        value={synced.outputSampleRate}
        onChange={(id) => patch('outputSampleRate', id)}
        testidPrefix="settings-sample-rate"
        labelFor={(id) => tr(`settings.sampleRates.${id}`)}
      />
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.sampleRateHint')}</p>

      {synced.outputFormat === 'flac' && (
        <>
          <span className="mb-1.5 block text-sm font-medium text-fg-muted">
            {tr('settings.flacCompression')}
          </span>
          <SegmentedControl
            options={['0', '5', '8'] as const}
            value={synced.flacCompression}
            onChange={(id) => patch('flacCompression', id)}
            testidPrefix="settings-flac-compression"
            labelFor={(id) => tr(`settings.flacCompressions.${id}`)}
          />
          <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.flacCompressionHint')}</p>
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
