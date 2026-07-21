import type React from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../../../shared/autoMatch'
import { DISCOGS_FORMATS, DISCOGS_MAX_RESULTS_OPTIONS } from '../../../../shared/defaults'
import type { Settings } from '../../../../shared/types'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { Select } from '../Select'
import { SettingsEyebrow, SettingsHint, SettingsLabel } from './SettingsPrimitives'

// The catalog sources offered as search-provider checkboxes (Settings → Search).
const SEARCH_PROVIDERS: Settings['searchProviders'] = ['discogs', 'bandcamp']

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
  // Auto-match is a global search setting (it can apply Bandcamp matches too), gated only on
  // having a source — plus a Discogs token when Discogs is one of them.
  const autoReady = autoMatchAvailable({
    searchProviders: synced.searchProviders,
    discogsToken: local.token,
  })
  return (
    <>
      <SettingsEyebrow className="mb-1.5">{tr('settings.searchProviders')}</SettingsEyebrow>
      <SettingsHint className="mb-3">{tr('settings.searchProvidersHint')}</SettingsHint>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2" data-testid="settings-search-providers">
        {SEARCH_PROVIDERS.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-2">
            <input
              data-testid={`settings-provider-${p}`}
              type="checkbox"
              checked={synced.searchProviders.includes(p)}
              onChange={(e) =>
                patch(
                  'searchProviders',
                  e.target.checked
                    ? [...synced.searchProviders, p]
                    : synced.searchProviders.filter((x) => x !== p),
                )
              }
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
          </label>
        ))}
      </div>

      {/* Auto-match belongs with the sources it sweeps (its hint even names them), so it
          shares their section instead of paying a whole separator of its own — one of the
          cuts that let this tab fit without scrolling. */}
      <label
        className={`flex items-center gap-3 ${
          autoReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
        }`}
      >
        <input
          data-testid="settings-auto-match"
          type="checkbox"
          checked={local.autoMatch && autoReady}
          disabled={!autoReady}
          onChange={(e) => patchLocal('autoMatch', e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm">{tr('settings.autoMatch')}</span>
      </label>
      <SettingsHint className="mt-1.5">
        {synced.searchProviders.length === 0
          ? tr('settings.autoMatchNeedsSource')
          : autoReady
            ? tr('settings.autoMatchHint')
            : tr('settings.autoMatchNeedsToken')}
      </SettingsHint>

      {/* A one-value select doesn't need a full-width stacked block: the label and hint
          take the left, the control sits on the right, one row instead of three. */}
      <div className="mt-5 flex items-center justify-between gap-6 border-t border-[var(--color-line)] pt-4">
        {/* The text side wraps (min-w-0) and the control side never shrinks: squeezed by
            justify-between, the select used to give up 2px and poke past the panel,
            summoning a horizontal scrollbar over the whole tab. */}
        <div className="min-w-0">
          <SettingsLabel className="mb-1">{tr('settings.maxResults')}</SettingsLabel>
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

      <div className="mt-5 border-t border-[var(--color-line)] pt-4">
        <SettingsLabel htmlFor="settings-ignore-words" className="mb-1">
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

      <div className="mt-5 border-t border-[var(--color-line)] pt-4">
        <SettingsEyebrow className="mb-3">{tr('settings.discogsSection')}</SettingsEyebrow>
        {!discogsOn && (
          <SettingsHint data-testid="settings-discogs-disabled" className="mb-4">
            {tr('settings.discogsDisabledHint')}
          </SettingsHint>
        )}
        <div className={discogsOn ? '' : 'opacity-50'}>
          <SettingsLabel htmlFor="settings-token" className="mb-1.5">
            {tr('settings.discogsToken')}
          </SettingsLabel>
          <input
            id="settings-token"
            data-testid="settings-token"
            value={local.token}
            disabled={!discogsOn}
            onChange={(e) => patchLocal('token', e.target.value)}
            placeholder={tr('settings.tokenPlaceholder')}
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed"
          />
          <SettingsHint className="mt-1.5 mb-5">
            {tr('settings.tokenWhy')} {tr('settings.tokenHelp')}{' '}
            <a
              href="https://www.discogs.com/settings/developers"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              discogs.com/settings/developers
            </a>
          </SettingsHint>

          <SettingsLabel className="mb-1.5">{tr('settings.discogsFormats')}</SettingsLabel>
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
      </div>
    </>
  )
}
