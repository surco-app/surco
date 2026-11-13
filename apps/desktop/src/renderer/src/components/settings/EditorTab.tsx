import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { TrackMetadata } from '../../../../shared/types'
import { renderTitle } from '../../lib/outputName'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'
import { FormatField, SAMPLE_META } from './FormatField'
import {
  SettingsCheckboxField,
  SettingsField,
  SettingsGroup,
  SettingsSection,
} from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function EditorTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const sample: TrackMetadata = {
    ...SAMPLE_META,
    custom: Object.fromEntries(synced.customFields.map((f) => [f.key, f.label])),
  }
  return (
    <>
      <SettingsSection first eyebrow={tr('settings.editorQuickButtonsTitle')}>
        <div className="flex flex-col gap-5">
          <SettingsField
            label={tr('settings.grouping')}
            searchId="grouping"
            htmlFor="settings-grouping"
            hint={tr('settings.groupingHint')}
          >
            <input
              id="settings-grouping"
              data-testid="settings-grouping"
              value={synced.grouping}
              onChange={(e) => patch('grouping', e.target.value)}
              placeholder={tr('settings.groupingPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </SettingsField>
          <SettingsField
            label={tr('settings.genre')}
            searchId="genre"
            htmlFor="settings-genre"
            hint={tr('settings.genreHint')}
          >
            <input
              id="settings-genre"
              data-testid="settings-genre"
              value={synced.genre}
              onChange={(e) => patch('genre', e.target.value)}
              placeholder={tr('settings.genrePlaceholder')}
              className="w-full rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.editorTagsTitle')}>
        <SettingsGroup>
          <div data-search-id="titleFormat">
            <FormatField
              id="settings-title-format"
              label={tr('settings.titleFormat')}
              value={synced.titleFormat}
              placeholder="({trackNumber}) {title} ({year})"
              hint={
                <p className="mt-2 text-xs leading-relaxed text-fg-dim">
                  {tr('settings.titleFormatHint')}
                </p>
              }
              preview={
                synced.titleFormat.trim() !== ''
                  ? renderTitle(synced.titleFormat, sample) || '—'
                  : undefined
              }
              customFields={synced.customFields}
              previewTestId="settings-title-format-preview"
              onChange={(v) => patch('titleFormat', v)}
            />
          </div>
          <SettingsCheckboxField
            testid="settings-full-release-date"
            checked={synced.fullReleaseDate}
            onChange={(v) => patch('fullReleaseDate', v)}
            label={tr('settings.fullReleaseDate')}
            searchId="fullReleaseDate"
            hint={tr('settings.fullReleaseDateHint')}
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.editorAnalysisTitle')}>
        <SettingsGroup>
          <div data-testid="settings-quality-analysis">
            <SettingsCheckboxField
              testid="settings-show-spectrum"
              checked={synced.showSpectrum}
              onChange={(v) => patch('showSpectrum', v)}
              label={tr('settings.showSpectrum')}
              searchId="showSpectrum"
              hint={tr('settings.showSpectrumHint')}
            />
            {/* Only meaningful while the quality analysis above is on — disabled (not hidden)
                when it isn't, so the option stays discoverable. */}
            <div
              data-testid="settings-auto-analyze-nested"
              className="mt-3 ml-2 border-l border-[var(--color-line-strong)] pl-[19px]"
            >
              <SettingsCheckboxField
                testid="settings-auto-analyze"
                checked={synced.autoAnalyze}
                onChange={(v) => patch('autoAnalyze', v)}
                disabled={!synced.showSpectrum}
                label={tr('settings.autoAnalyze')}
                searchId="autoAnalyze"
                hint={tr('settings.autoAnalyzeHint')}
              />
            </div>
          </div>
          <SettingsCheckboxField
            testid="settings-show-loudness"
            checked={synced.showLoudness}
            onChange={(v) => patch('showLoudness', v)}
            label={tr('settings.showLoudness')}
            searchId="showLoudness"
            hint={tr('settings.showLoudnessHint')}
          />
          <SettingsCheckboxField
            testid="settings-show-editor-hints"
            checked={synced.showEditorHints}
            onChange={(v) => patch('showEditorHints', v)}
            label={tr('settings.showEditorHints')}
            searchId="showEditorHints"
            hint={tr('settings.showEditorHintsHint')}
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.editorKeyTitle')}>
        <SettingsGroup>
          <SettingsField
            label={tr('settings.keyNotation')}
            hint={tr('settings.keyNotationHint')}
            searchId="keyNotation"
          >
            <SegmentedControl
              options={['camelot', 'musical'] as const}
              value={synced.keyNotation}
              onChange={(id) => patch('keyNotation', id)}
              testidPrefix="settings-key-notation"
              label={tr('settings.keyNotation')}
              labelFor={(id) => tr(`settings.keyNotations.${id}`)}
            />
          </SettingsField>
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}
