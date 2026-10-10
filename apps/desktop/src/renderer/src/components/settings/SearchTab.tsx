import type React from 'react'
import { useTranslation } from 'react-i18next'
import { DISCOGS_FORMATS, DISCOGS_MAX_RESULTS_OPTIONS } from '../../../../shared/defaults'
import type { Settings } from '../../../../shared/types'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { AutoMatchControl } from '../AutoMatchControl'
import { BeatportAccountField } from '../BeatportAccountField'
import { DiscogsTokenField } from '../DiscogsTokenField'
import { SearchProvidersControl } from '../SearchProvidersControl'
import { Select } from '../Select'
import {
  SettingsCheckboxField,
  SettingsHint,
  SettingsLabel,
  SettingsSection,
} from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  local: LocalDraft
  patch: PatchSynced
  patchLocal: PatchLocal
  onBeatportChange: (next: Settings) => void
}

export function SearchTab({
  synced,
  local,
  patch,
  patchLocal,
  onBeatportChange,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The format filter trims every source whose rows name a release's medium: Discogs and
  // MusicBrainz. The token and the Beatport account sit in their source's row instead.
  const discogsOn = synced.searchProviders.includes('discogs')
  const formatsOn = discogsOn || synced.searchProviders.includes('musicbrainz')
  const beatportOn = synced.searchProviders.includes('beatport')
  return (
    <>
      <SettingsSection first eyebrow={tr('settings.searchProviders')}>
        <SettingsHint className="-mt-1.5 mb-3">{tr('settings.searchSourcesIntro')}</SettingsHint>
        <SearchProvidersControl
          value={synced.searchProviders}
          onChange={(value) => patch('searchProviders', value)}
          testid="settings-search-providers"
          testidPrefix="settings-provider"
          details={{
            discogs: (
              <DiscogsTokenField
                value={local.token}
                onChange={(value) => patchLocal('token', value)}
                testid="settings-token"
                disabled={!discogsOn}
              />
            ),
            beatport: (
              <>
                <SettingsHint className="mb-3">{tr('settings.beatportHint')}</SettingsHint>
                <BeatportAccountField
                  username={local.beatportUsername}
                  disabled={!beatportOn}
                  onChange={onBeatportChange}
                />
              </>
            ),
          }}
        />
      </SettingsSection>

      {/* What the result list shows: which formats and how many rows. */}
      <SettingsSection eyebrow={tr('settings.searchResultsSection')}>
        {!formatsOn && (
          <SettingsHint data-testid="settings-formats-disabled" className="mb-4">
            {tr('settings.discogsFormatsDisabledHint')}
          </SettingsHint>
        )}
        <div className={formatsOn ? '' : 'opacity-50'}>
          <SettingsLabel className="mb-2">{tr('settings.discogsFormats')}</SettingsLabel>
          <SettingsHint className="mb-3">{tr('settings.discogsFormatsHint')}</SettingsHint>
          <div className="flex flex-wrap gap-x-5 gap-y-2" data-testid="settings-discogs-formats">
            {DISCOGS_FORMATS.map((f) => (
              <label
                key={f}
                className={`flex items-center gap-2 ${formatsOn ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                <input
                  data-testid={`settings-format-${f}`}
                  type="checkbox"
                  checked={synced.discogsFormats.includes(f)}
                  disabled={!formatsOn}
                  onChange={(e) =>
                    patch(
                      'discogsFormats',
                      e.target.checked
                        ? [...synced.discogsFormats, f]
                        : synced.discogsFormats.filter((x) => x !== f),
                    )
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="text-sm">{tr(`settings.format.${f}`)}</span>
              </label>
            ))}
          </div>
        </div>

        {/* A one-value select doesn't need a full-width stacked block: the label and hint
            take the left, the control sits on the right, one row instead of three. */}
        <div className="mt-5 flex items-center justify-between gap-6">
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

      {/* How the search runs and what it does on its own: the album-first order, the words
          it strips, and auto-match, a behaviour (when matches get applied) not a source. */}
      <SettingsSection eyebrow={tr('settings.searchMatchingSection')}>
        <div className="flex flex-col gap-5">
          <SettingsCheckboxField
            testid="settings-search-album-first"
            checked={synced.searchByAlbumFirst}
            onChange={(v) => patch('searchByAlbumFirst', v)}
            label={tr('settings.searchByAlbumFirst')}
            hint={tr('settings.searchByAlbumFirstHint')}
          />
          <div>
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
          </div>
          <AutoMatchControl
            checked={local.autoMatch}
            onChange={(checked) => patchLocal('autoMatch', checked)}
            searchProviders={synced.searchProviders}
            discogsToken={local.token}
            beatportUsername={local.beatportUsername}
            testid="settings-auto-match"
          />
          <SettingsCheckboxField
            testid="settings-auto-clean-spacing"
            checked={synced.autoCleanSpacing}
            onChange={(v) => patch('autoCleanSpacing', v)}
            label={tr('settings.autoCleanSpacing')}
            hint={tr('settings.autoCleanSpacingHint')}
          />
          <SettingsCheckboxField
            testid="settings-auto-clean-case"
            checked={synced.autoCleanCase}
            onChange={(v) => patch('autoCleanCase', v)}
            label={tr('settings.autoCleanCase')}
            hint={tr('settings.autoCleanCaseHint')}
          />
        </div>
      </SettingsSection>
    </>
  )
}
