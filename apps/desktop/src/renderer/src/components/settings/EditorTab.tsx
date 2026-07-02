import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function EditorTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <>
      <label htmlFor="settings-grouping" className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.grouping')}
      </label>
      <input
        id="settings-grouping"
        data-testid="settings-grouping"
        value={synced.grouping}
        onChange={(e) => patch('grouping', e.target.value)}
        placeholder={tr('settings.groupingPlaceholder')}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.groupingHint')}</p>

      <label htmlFor="settings-genre" className="mb-1.5 block text-sm font-medium text-fg-muted">
        {tr('settings.genre')}
      </label>
      <input
        id="settings-genre"
        data-testid="settings-genre"
        value={synced.genre}
        onChange={(e) => patch('genre', e.target.value)}
        placeholder="Hard Dance, Techno"
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-1.5 mb-5 text-xs text-fg-dim">{tr('settings.genreHint')}</p>

      <div className="space-y-3 border-t border-[var(--color-line)] pt-5">
        <div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              data-testid="settings-show-spectrum"
              type="checkbox"
              checked={synced.showSpectrum}
              onChange={(e) => patch('showSpectrum', e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr('settings.showSpectrum')}</span>
          </label>
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.showSpectrumHint')}</p>
        </div>
        {/* Only meaningful while the quality analysis above is on — disabled (not hidden)
            when it isn't, so the option stays discoverable. */}
        <div className={synced.showSpectrum ? '' : 'opacity-50'}>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              data-testid="settings-auto-analyze"
              type="checkbox"
              checked={synced.autoAnalyze}
              disabled={!synced.showSpectrum}
              onChange={(e) => patch('autoAnalyze', e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr('settings.autoAnalyze')}</span>
          </label>
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.autoAnalyzeHint')}</p>
        </div>
        <div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              data-testid="settings-show-loudness"
              type="checkbox"
              checked={synced.showLoudness}
              onChange={(e) => patch('showLoudness', e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm">{tr('settings.showLoudness')}</span>
          </label>
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.showLoudnessHint')}</p>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-fg-muted">
            {tr('settings.keyNotation')}
          </span>
          <SegmentedControl
            options={['camelot', 'musical'] as const}
            value={synced.keyNotation}
            onChange={(id) => patch('keyNotation', id)}
            testidPrefix="settings-key-notation"
            labelFor={(id) => tr(`settings.keyNotations.${id}`)}
          />
          <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.keyNotationHint')}</p>
        </div>
      </div>
    </>
  )
}
