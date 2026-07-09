import type React from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../../../shared/autoMatch'
import { DISCOGS_FORMATS, DISCOGS_MAX_RESULTS_OPTIONS } from '../../../../shared/defaults'
import type { Settings } from '../../../../shared/types'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchLocal, PatchSynced } from '../../lib/settingsTabs'
import { Select } from '../Select'

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
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-dim">
        {tr('settings.searchProviders')}
      </p>
      <p className="mb-3 text-xs text-fg-dim">{tr('settings.searchProvidersHint')}</p>
      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2" data-testid="settings-search-providers">
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

      <div className="mt-6 border-t border-[var(--color-line)] pt-5">
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
        <p className="mt-1.5 text-xs text-fg-dim">
          {synced.searchProviders.length === 0
            ? tr('settings.autoMatchNeedsSource')
            : autoReady
              ? tr('settings.autoMatchHint')
              : tr('settings.autoMatchNeedsToken')}
        </p>
      </div>

      <div className="mt-6 border-t border-[var(--color-line)] pt-5">
        <p className="mb-1.5 text-sm font-medium text-fg-muted">{tr('settings.maxResults')}</p>
        <p className="mb-3 text-xs text-fg-dim">{tr('settings.maxResultsHint')}</p>
        <Select
          testid="settings-max-results"
          label={tr('settings.maxResults')}
          value={String(synced.discogsMaxResults)}
          onChange={(v) => patch('discogsMaxResults', Number(v))}
          options={DISCOGS_MAX_RESULTS_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>

      <div className="mt-6 border-t border-[var(--color-line)] pt-5">
        <label
          htmlFor="settings-ignore-words"
          className="mb-1.5 block text-sm font-medium text-fg-muted"
        >
          {tr('settings.searchIgnoreWords')}
        </label>
        <p className="mb-3 text-xs text-fg-dim">{tr('settings.searchIgnoreWordsHint')}</p>
        <input
          id="settings-ignore-words"
          data-testid="settings-ignore-words"
          value={synced.searchIgnoreWords}
          onChange={(e) => patch('searchIgnoreWords', e.target.value)}
          placeholder="vinyl, rip"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      <div className="mt-6 border-t border-[var(--color-line)] pt-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-dim">
          {tr('settings.discogsSection')}
        </p>
        {!discogsOn && (
          <p data-testid="settings-discogs-disabled" className="mb-4 text-xs text-fg-dim">
            {tr('settings.discogsDisabledHint')}
          </p>
        )}
        <div className={discogsOn ? '' : 'opacity-50'}>
          <label
            htmlFor="settings-token"
            className="mb-1.5 block text-sm font-medium text-fg-muted"
          >
            {tr('settings.discogsToken')}
          </label>
          <input
            id="settings-token"
            data-testid="settings-token"
            value={local.token}
            disabled={!discogsOn}
            onChange={(e) => patchLocal('token', e.target.value)}
            placeholder={tr('settings.tokenPlaceholder')}
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:cursor-not-allowed"
          />
          <p className="mt-1.5 mb-5 text-xs text-fg-dim">
            {tr('settings.tokenWhy')} {tr('settings.tokenHelp')}{' '}
            <a
              href="https://www.discogs.com/settings/developers"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              discogs.com/settings/developers
            </a>
          </p>

          <p className="mb-1.5 text-sm font-medium text-fg-muted">
            {tr('settings.discogsFormats')}
          </p>
          <p className="mb-3 text-xs text-fg-dim">{tr('settings.discogsFormatsHint')}</p>
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
