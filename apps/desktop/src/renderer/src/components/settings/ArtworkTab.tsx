import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function ArtworkTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <>
      <label
        htmlFor="settings-cover-max"
        className="mb-1.5 block text-sm font-medium text-fg-muted"
      >
        {tr('settings.coverMaxSize')}
      </label>
      <div className="mb-5 flex items-center gap-2">
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

      <label className="mb-5 flex cursor-pointer items-center gap-3">
        <input
          data-testid="settings-cover-upscale"
          type="checkbox"
          checked={synced.coverUpscale}
          onChange={(e) => patch('coverUpscale', e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm">{tr('settings.coverUpscale')}</span>
      </label>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          data-testid="settings-cover-square"
          type="checkbox"
          checked={synced.coverSquare}
          onChange={(e) => patch('coverSquare', e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm">{tr('settings.coverSquare')}</span>
      </label>
      <p className="mt-3 text-xs text-fg-dim">{tr('settings.coverHint')}</p>

      <label className="mt-5 flex cursor-pointer items-center gap-3">
        <input
          data-testid="settings-replace-lowres"
          type="checkbox"
          checked={synced.replaceLowResCover}
          onChange={(e) => patch('replaceLowResCover', e.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm">{tr('settings.replaceLowRes')}</span>
      </label>
      <p className="mt-3 text-xs text-fg-dim">{tr('settings.replaceLowResHint')}</p>
    </>
  )
}
