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

function AppliesHint({
  testid,
  applies,
  hint,
}: {
  testid: string
  applies: string
  hint: string
}): React.JSX.Element {
  return (
    <>
      <span data-testid={testid}>{applies}</span> {hint}
    </>
  )
}

// Everything that defines the converted file itself: format, the per-format quality
// knobs and loudness normalization. Where the file ends up (folder, Apple Music,
// Engine DJ) lives in the Destination tab.
export function ConversionTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
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

        <SettingsField
          label={tr('settings.mp3Quality')}
          hint={
            <AppliesHint
              testid="settings-mp3-quality-applies"
              applies={tr('settings.mp3QualityApplies')}
              hint={tr('settings.mp3QualityHint')}
            />
          }
        >
          <SegmentedControl
            options={['320', '256', '192', '160', '128', 'v0', 'v2'] as const}
            value={synced.mp3Quality}
            onChange={(id) => patch('mp3Quality', id)}
            testidPrefix="settings-mp3-quality"
            labelFor={(id) => tr(`settings.mp3Qualities.${id}`)}
          />
        </SettingsField>

        <SettingsField
          label={tr('settings.bitDepth')}
          hint={
            <AppliesHint
              testid="settings-bit-depth-applies"
              applies={tr('settings.bitDepthApplies')}
              hint={tr('settings.bitDepthHint')}
            />
          }
        >
          <SegmentedControl
            options={['source', '16', '24', 'corrected'] as const}
            value={synced.outputBitDepth}
            onChange={(id) => patch('outputBitDepth', id)}
            testidPrefix="settings-bit-depth"
            labelFor={(id) => tr(`settings.bitDepths.${id}`)}
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
            <AppliesHint
              testid="settings-flac-compression-applies"
              applies={tr('settings.flacCompressionApplies')}
              hint={tr('settings.flacCompressionHint')}
            />
          }
        >
          <SegmentedControl
            options={['0', '5', '8'] as const}
            value={synced.flacCompression}
            onChange={(id) => patch('flacCompression', id)}
            testidPrefix="settings-flac-compression"
            labelFor={(id) => tr(`settings.flacCompressions.${id}`)}
          />
        </SettingsField>
      </div>
    </SettingsSection>
  )
}
