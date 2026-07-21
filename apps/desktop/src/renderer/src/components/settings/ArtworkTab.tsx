import type React from 'react'
import { useTranslation } from 'react-i18next'
import { isMacOS } from '../../lib/platform'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
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

export function ArtworkTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <>
      <SettingsSection first>
        <SettingsField label={tr('settings.coverMaxSize')} htmlFor="settings-cover-max">
          <div className="flex items-center gap-2">
            <input
              id="settings-cover-max"
              data-testid="settings-cover-max"
              type="number"
              min={0}
              value={synced.coverMaxSize}
              onChange={(e) => patch('coverMaxSize', e.target.value)}
              // An invalid cap (blank, negative, garbage) used to save silently
              // as the default; clamping on blur shows the figure in effect.
              onBlur={() => {
                const max = parseInt(synced.coverMaxSize, 10)
                if (!Number.isFinite(max) || max < 0) patch('coverMaxSize', '1200')
              }}
              className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-sm text-fg-dim">{tr('settings.coverMaxHint')}</span>
          </div>
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <SettingsGroup>
          <SettingsCheckboxField
            testid="settings-cover-upscale"
            checked={synced.coverUpscale}
            onChange={(v) => patch('coverUpscale', v)}
            label={tr('settings.coverUpscale')}
          />
          <SettingsCheckboxField
            testid="settings-cover-square"
            checked={synced.coverSquare}
            onChange={(v) => patch('coverSquare', v)}
            label={tr('settings.coverSquare')}
            hint={tr('settings.coverHint')}
          />
          <SettingsCheckboxField
            testid="settings-replace-lowres"
            checked={synced.replaceLowResCover}
            onChange={(v) => patch('replaceLowResCover', v)}
            label={tr('settings.replaceLowRes')}
            hint={tr('settings.replaceLowResHint')}
          />
          {isMacOS() && (
            <SettingsCheckboxField
              testid="settings-flac-finder-covers"
              checked={synced.flacFinderCovers}
              onChange={(v) => patch('flacFinderCovers', v)}
              label={tr('settings.flacFinderCovers')}
              hint={tr('settings.flacFinderCoversHint')}
            />
          )}
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}
