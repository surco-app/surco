import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { FormatSettingControl } from '../FormatSettingControl'
import { SegmentedControl } from '../SegmentedControl'
import { SettingsCheckboxField, SettingsField, SettingsSection } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

function OffHint({ testid, children }: { testid: string; children: string }): React.JSX.Element {
  return <span data-testid={testid}>{children}</span>
}

// The format and the everyday per-format choices. The encoder fine print is
// EncoderAdvancedSettings, shown under the Output tab's Advanced fold.
export function ConversionTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const mp3Off = synced.outputFormat !== 'mp3' && synced.outputFormat !== 'source'
  const keepMp3Off = synced.outputFormat === 'mp3' || synced.outputFormat === 'source'
  return (
    <SettingsSection first>
      <div className="flex flex-col gap-5">
        <SettingsField label={tr('settings.outputFormat')} hint={tr('settings.outputFormatHint')}>
          <FormatSettingControl
            value={synced.outputFormat}
            onChange={(id) => patch('outputFormat', id)}
            testidPrefix="settings-format"
          />
        </SettingsField>

        {/* The encoder choice applies while MP3 (or "Same as source") is the pick;
              under any other format it stays in view, disabled, with the reason. */}
        <SettingsField
          label={tr('settings.mp3Quality')}
          hint={
            mp3Off ? (
              <OffHint testid="settings-mp3-quality-off">{tr('settings.mp3QualityOff')}</OffHint>
            ) : (
              tr('settings.mp3QualityHint')
            )
          }
        >
          <SegmentedControl
            options={['320', '256', '192', '160', '128', 'v0', 'v2'] as const}
            value={synced.mp3Quality}
            onChange={(id) => patch('mp3Quality', id)}
            testidPrefix="settings-mp3-quality"
            labelFor={(id) => tr(`settings.mp3Qualities.${id}`)}
            disabled={mp3Off}
          />
        </SettingsField>

        {/* Only acts while the export would transcode an mp3: under MP3 or "Same as
              source" the rule never fires, so it is disabled and says so. */}
        <SettingsCheckboxField
          testid="settings-keep-mp3"
          checked={synced.keepMp3Sources}
          onChange={(v) => patch('keepMp3Sources', v)}
          label={tr('settings.keepMp3Sources')}
          hint={keepMp3Off ? tr('settings.keepMp3SourcesOff') : tr('settings.keepMp3SourcesHint')}
          disabled={keepMp3Off}
        />
      </div>
    </SettingsSection>
  )
}

export function EncoderAdvancedSettings({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const bitDepthOff = synced.outputFormat === 'mp3'
  const flacOff = synced.outputFormat !== 'flac' && synced.outputFormat !== 'source'
  return (
    <div className="flex flex-col gap-5">
      {/* Bit depth shapes the PCM/FLAC/ALAC encoders; LAME has no bit depth, so under
            MP3 it is disabled with the reason. */}
      <SettingsField
        label={tr('settings.bitDepth')}
        hint={
          bitDepthOff ? (
            <OffHint testid="settings-bit-depth-off">{tr('settings.bitDepthOff')}</OffHint>
          ) : (
            tr('settings.bitDepthHint')
          )
        }
      >
        <SegmentedControl
          options={['source', '16', '24', 'corrected'] as const}
          value={synced.outputBitDepth}
          onChange={(id) => patch('outputBitDepth', id)}
          testidPrefix="settings-bit-depth"
          labelFor={(id) => tr(`settings.bitDepths.${id}`)}
          disabled={bitDepthOff}
        />
      </SettingsField>

      <SettingsField label={tr('settings.sampleRate')} hint={tr('settings.sampleRateHint')}>
        <SegmentedControl
          options={['source', '44100', '48000', 'corrected'] as const}
          value={synced.outputSampleRate}
          onChange={(id) => patch('outputSampleRate', id)}
          testidPrefix="settings-sample-rate"
          labelFor={(id) => tr(`settings.sampleRates.${id}`)}
        />
      </SettingsField>

      <SettingsField
        label={tr('settings.flacCompression')}
        hint={
          flacOff ? (
            <OffHint testid="settings-flac-compression-off">
              {tr('settings.flacCompressionOff')}
            </OffHint>
          ) : (
            tr('settings.flacCompressionHint')
          )
        }
      >
        <SegmentedControl
          options={['0', '5', '8'] as const}
          value={synced.flacCompression}
          onChange={(id) => patch('flacCompression', id)}
          testidPrefix="settings-flac-compression"
          labelFor={(id) => tr(`settings.flacCompressions.${id}`)}
          disabled={flacOff}
        />
      </SettingsField>
    </div>
  )
}
