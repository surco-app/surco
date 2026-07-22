import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DISCOGS_FORMATS, DISCOGS_MAX_RESULTS_OPTIONS } from '../../../../shared/defaults'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { AutoMatchControl } from '../AutoMatchControl'
import { DiscogsTokenField } from '../DiscogsTokenField'
import { SearchProvidersControl } from '../SearchProvidersControl'
import { Select } from '../Select'
import {
  SettingsEyebrow,
  SettingsHint,
  SettingsLabel,
  SettingsSection,
} from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  local: LocalDraft
  patch: PatchSynced
  patchLocal: PatchLocal
}

export function SearchTab({ synced, local, patch, patchLocal }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The token and format filter only act on Discogs results, so they're grouped under a
  // Discogs heading and disabled when Discogs isn't a chosen source.
  const discogsOn = synced.searchProviders.includes('discogs')
  return (
    <>
      <SettingsSection first>
      <SettingsEyebrow className="mb-1.5">{tr('settings.searchProviders')}</SettingsEyebrow>
      <SettingsHint className="mb-3">{tr('settings.searchProvidersHint')}</SettingsHint>
      <SearchProvidersControl
        value={synced.searchProviders}
        onChange={(value) => patch('searchProviders', value)}
        testid="settings-search-providers"
        testidPrefix="settings-provider"
      />
      </SettingsSection>

      {/* Auto-match is a behaviour (when matches get applied), not a source, so it sits in
          its own section apart from the Discogs/Bandcamp source checkboxes. */}
      <SettingsSection>
      <AutoMatchControl
        checked={local.autoMatch}
        onChange={(checked) => patchLocal('autoMatch', checked)}
        searchProviders={synced.searchProviders}
        discogsToken={local.token}
        testid="settings-auto-match"
      />
      </SettingsSection>

      {/* A one-value select doesn't need a full-width stacked block: the label and hint
          take the left, the control sits on the right, one row instead of three. */}
      <SettingsSection>
      <div className="flex items-center justify-between gap-6">
        {/* The text side wraps (min-w-0) and the control side never shrinks: squeezed by
            justify-between, the select used to give up 2px and poke past the panel,
            summoning a horizontal scrollbar over the whole tab. */}
        <div className="min-w-0 flex flex-col gap-2">
          <SettingsLabel>{tr('settings.maxResults')}</SettingsLabel>
          <SettingsHint>{tr('settings.maxResultsHint')}</SettingsHint>
        </div>
        <div className="shrink-0">
          <Select
            testid="settings-max-results"
            label={tr('settings.maxResults')}
            value={String(synced.discogsMaxResults)}
            onChange={(v) => patch('discogsMaxResults', Number(v))}
            options={DISCOGS_MAX_RESULTS_OPTIONS.map((n) => ({
              value: String(n),
              label: String(n),
            }))}
          />
        </div>
      </div>
      </SettingsSection>

      <SettingsSection>
        <SettingsLabel htmlFor="settings-ignore-words" className="mb-2">
          {tr('settings.searchIgnoreWords')}
        </SettingsLabel>
        <SettingsHint className="mb-2.5">{tr('settings.searchIgnoreWordsHint')}</SettingsHint>
        <input
          id="settings-ignore-words"
          data-testid="settings-ignore-words"
          value={synced.searchIgnoreWords}
          onChange={(e) => patch('searchIgnoreWords', e.target.value)}
          placeholder="vinyl, rip"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </SettingsSection>

      <SettingsSection eyebrow={tr('settings.discogsSection')}>
        {!discogsOn && (
          <SettingsHint data-testid="settings-discogs-disabled" className="mb-4">
            {tr('settings.discogsDisabledHint')}
          </SettingsHint>
        )}
        <div className={discogsOn ? '' : 'opacity-50'}>
          <div className="mb-5">
            <DiscogsTokenField
              value={local.token}
              onChange={(value) => patchLocal('token', value)}
              testid="settings-token"
              disabled={!discogsOn}
            />
          </div>

          <SettingsLabel className="mb-2">{tr('settings.discogsFormats')}</SettingsLabel>
          <SettingsHint className="mb-3">{tr('settings.discogsFormatsHint')}</SettingsHint>
          <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="settings-discogs-formats">
            {DISCOGS_FORMATS.map((f) => (
              <label
                key={f}
                className={`flex items-center gap-2 ${discogsOn ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                <input
                  data-testid={`settings-format-${f}`}
                  type="checkbox"
                  checked={synced.discogsFormats.includes(f)}
                  disabled={!discogsOn}
                  onChange={(e) =>
                    patch(
                      'discogsFormats',
                      e.target.checked
                        ? [...synced.discogsFormats, f]
                        : synced.discogsFormats.filter((x) => x !== f),
                    )
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr(`settings.format.${f}`)}</span>
              </label>
            ))}
          </div>
        </div>
      </SettingsSection>
    </>
  )
}
