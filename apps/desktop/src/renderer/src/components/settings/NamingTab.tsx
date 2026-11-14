import type React from 'react'
import { useTranslation } from 'react-i18next'
import { foldAccents } from '../../../../shared/foldAccents'
import { formatExtension } from '../../../../shared/format'
import type { TrackMetadata } from '../../../../shared/types'
import { renderOutputName } from '../../lib/outputName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { FormatField, SAMPLE_META } from './FormatField'
import { SettingsCheckboxField, SettingsGroup, SettingsSection } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function NamingTab({ synced, patch }: Props): React.JSX.Element {
  // A custom field has no sample of its own, so the preview shows its name in its place.
  const sample: TrackMetadata = {
    ...SAMPLE_META,
    custom: Object.fromEntries(synced.customFields.map((f) => [f.key, f.label])),
  }
  const renderedName = renderOutputName(synced.filenameFormat, sample)
  const previewName = synced.asciiFileNames ? foldAccents(renderedName) : renderedName
  const { t: tr } = useTranslation()

  return (
    <>
      <SettingsSection first searchId="filenameFormat">
        <FormatField
          id="settings-filename-format"
          label={tr('settings.filenameFormat')}
          value={synced.filenameFormat}
          placeholder="{artist} - {title}"
          hint={
            <p className="mt-2 text-xs leading-relaxed text-fg-dim">
              {tr('settings.filenameFolderHint')}{' '}
              <span className="font-mono text-fg-muted">
                {'{discogsReleaseId}/{artist} - {title}'}
              </span>
            </p>
          }
          preview={`${previewName || '—'}.${formatExtension(
            synced.outputFormat === 'source' ? 'aiff' : synced.outputFormat,
          )}`}
          customFields={synced.customFields}
          previewTestId="settings-format-preview"
          onChange={(v) => patch('filenameFormat', v)}
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsGroup>
          <SettingsCheckboxField
            testid="settings-auto-apply-filename"
            checked={synced.autoApplyFilename}
            onChange={(v) => patch('autoApplyFilename', v)}
            label={tr('settings.autoApplyFilename')}
            searchId="autoApplyFilename"
            hint={tr('settings.autoApplyFilenameHint')}
          />
          <SettingsCheckboxField
            testid="settings-ascii-file-names"
            checked={synced.asciiFileNames}
            onChange={(v) => patch('asciiFileNames', v)}
            label={tr('settings.asciiFileNames')}
            searchId="asciiFileNames"
            hint={tr('settings.asciiFileNamesHint')}
          />
          <SettingsCheckboxField
            testid="settings-trim"
            checked={synced.trimWhitespace}
            onChange={(v) => patch('trimWhitespace', v)}
            label={tr('settings.trimWhitespace')}
            searchId="trimWhitespace"
          />
          <SettingsCheckboxField
            testid="settings-zeropad"
            checked={synced.zeroPadTrack}
            onChange={(v) => patch('zeroPadTrack', v)}
            label={tr('settings.zeroPadTrack')}
            searchId="zeroPadTrack"
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}
