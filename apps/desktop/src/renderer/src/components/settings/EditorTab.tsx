import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'
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
  return (
    <>
      <SettingsSection first>
        <div className="flex flex-col gap-5">
          <SettingsField
            label={tr('settings.grouping')}
            htmlFor="settings-grouping"
            hint={tr('settings.groupingHint')}
          >
            <input
              id="settings-grouping"
              data-testid="settings-grouping"
              value={synced.grouping}
              onChange={(e) => patch('grouping', e.target.value)}
              placeholder={tr('settings.groupingPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </SettingsField>
          <SettingsField
            label={tr('settings.genre')}
            htmlFor="settings-genre"
            hint={tr('settings.genreHint')}
          >
            <input
              id="settings-genre"
              data-testid="settings-genre"
              value={synced.genre}
              onChange={(e) => patch('genre', e.target.value)}
              placeholder={tr('settings.genrePlaceholder')}
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection>
        <SettingsGroup>
          <SettingsCheckboxField
            testid="settings-show-spectrum"
            checked={synced.showSpectrum}
            onChange={(v) => patch('showSpectrum', v)}
            label={tr('settings.showSpectrum')}
            hint={tr('settings.showSpectrumHint')}
          />
          {/* Only meaningful while the quality analysis above is on — disabled (not hidden)
              when it isn't, so the option stays discoverable. */}
          <SettingsCheckboxField
            testid="settings-auto-analyze"
            checked={synced.autoAnalyze}
            onChange={(v) => patch('autoAnalyze', v)}
            disabled={!synced.showSpectrum}
            label={tr('settings.autoAnalyze')}
            hint={tr('settings.autoAnalyzeHint')}
          />
          <SettingsCheckboxField
            testid="settings-show-loudness"
            checked={synced.showLoudness}
            onChange={(v) => patch('showLoudness', v)}
            label={tr('settings.showLoudness')}
            hint={tr('settings.showLoudnessHint')}
          />
          <SettingsField label={tr('settings.keyNotation')} hint={tr('settings.keyNotationHint')}>
            <SegmentedControl
              options={['camelot', 'musical'] as const}
              value={synced.keyNotation}
              onChange={(id) => patch('keyNotation', id)}
              testidPrefix="settings-key-notation"
              labelFor={(id) => tr(`settings.keyNotations.${id}`)}
            />
          </SettingsField>
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}
