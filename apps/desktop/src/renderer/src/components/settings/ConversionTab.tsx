import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../../shared/types'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { DeclickControls } from '../DeclickControls'
import { NormalizeControls } from '../NormalizeControls'
import { SegmentedControl } from '../SegmentedControl'
import { SettingsField, SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

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
      <SettingsSection first>
        <div className="flex flex-col gap-5">
          <SettingsField label={tr('settings.outputFormat')} hint={tr('settings.outputFormatHint')}>
            <SegmentedControl
              options={FORMATS}
              value={synced.outputFormat}
              onChange={(id) => patch('outputFormat', id)}
              testidPrefix="settings-format"
              labelFor={(id) => tr(`settings.formats.${id}`)}
            />
          </SettingsField>

          {/* Contextual like the FLAC note: the encoder choice only matters while MP3 is
              the pick, though it applies to every MP3 export (the editor's ad-hoc ones too). */}
          {synced.outputFormat === 'mp3' && (
            <SettingsField label={tr('settings.mp3Quality')} hint={tr('settings.mp3QualityHint')}>
              <SegmentedControl
                options={['320', '256', '192', '160', '128', 'v0', 'v2'] as const}
                value={synced.mp3Quality}
                onChange={(id) => patch('mp3Quality', id)}
                testidPrefix="settings-mp3-quality"
                labelFor={(id) => tr(`settings.mp3Qualities.${id}`)}
              />
            </SettingsField>
          )}

          {/* Bit depth shapes the PCM/FLAC/ALAC encoders; LAME has no bit depth, so under
              MP3 the control would read as a knob that does nothing. */}
          {synced.outputFormat !== 'mp3' && (
            <SettingsField label={tr('settings.bitDepth')} hint={tr('settings.bitDepthHint')}>
              <SegmentedControl
                options={['source', '16', '24'] as const}
                value={synced.outputBitDepth}
                onChange={(id) => patch('outputBitDepth', id)}
                testidPrefix="settings-bit-depth"
                labelFor={(id) => tr(`settings.bitDepths.${id}`)}
              />
            </SettingsField>
          )}

          <SettingsField label={tr('settings.sampleRate')} hint={tr('settings.sampleRateHint')}>
            <SegmentedControl
              options={['source', '44100', '48000'] as const}
              value={synced.outputSampleRate}
              onChange={(id) => patch('outputSampleRate', id)}
              testidPrefix="settings-sample-rate"
              labelFor={(id) => tr(`settings.sampleRates.${id}`)}
            />
          </SettingsField>

          {synced.outputFormat === 'flac' && (
            <SettingsField
              label={tr('settings.flacCompression')}
              hint={tr('settings.flacCompressionHint')}
            >
              <SegmentedControl
                options={['0', '5', '8'] as const}
                value={synced.flacCompression}
                onChange={(id) => patch('flacCompression', id)}
                testidPrefix="settings-flac-compression"
                labelFor={(id) => tr(`settings.flacCompressions.${id}`)}
              />
            </SettingsField>
          )}
        </div>
      </SettingsSection>

      {/* Above normalization, matching the order the conversion applies them in:
          repair the clicks first, then size the loudness/peak gain on the result. */}
      <SettingsSection>
        <SettingsLabel>{tr('declick.title')}</SettingsLabel>
        <SettingsHint className="mt-2 mb-3">{tr('declick.hint')}</SettingsHint>
        <DeclickControls value={synced.declick} onChange={(d) => patch('declick', d)} />
      </SettingsSection>

      <SettingsSection>
        <SettingsLabel>{tr('normalize.title')}</SettingsLabel>
        <SettingsHint className="mt-2 mb-3">{tr('normalize.hint')}</SettingsHint>
        <NormalizeControls value={synced.normalize} onChange={(n) => patch('normalize', n)} />
      </SettingsSection>
    </>
  )
}
