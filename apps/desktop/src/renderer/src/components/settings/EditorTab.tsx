import { ChevronDown, ChevronUp } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorSectionPref } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function EditorTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const sections = synced.editorSections
  const setSections = (next: EditorSectionPref[]): void => patch('editorSections', next)
  const toggleOpen = (id: EditorSectionPref['id']): void =>
    setSections(sections.map((s) => (s.id === id ? { ...s, open: !s.open } : s)))
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...sections]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row)
    setSections(next)
  }
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
        placeholder={tr('settings.genrePlaceholder')}
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

      <div className="mt-5 border-t border-[var(--color-line)] pt-5">
        <span className="block text-sm font-medium text-fg-muted">
          {tr('settings.sections.title')}
        </span>
        <p className="mt-1.5 mb-3 text-xs text-fg-dim">{tr('settings.sections.hint')}</p>
        <div className="space-y-1">
          {sections.map((section, i) => {
            const movable = section.id !== 'form'
            // Index 1 sits right under the pinned metadata form, so it can't climb.
            const canUp = movable && i > 1
            const canDown = movable && i < sections.length - 1
            return (
              <div
                key={section.id}
                data-testid={`settings-section-row-${section.id}`}
                className="flex items-center gap-3 rounded-lg bg-[var(--color-field)] px-3 py-2"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    data-testid={`settings-section-open-${section.id}`}
                    type="checkbox"
                    checked={section.open}
                    onChange={() => toggleOpen(section.id)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="truncate text-sm">{tr(`settings.sections.${section.id}`)}</span>
                </label>
                {movable ? (
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      data-testid={`settings-section-up-${section.id}`}
                      aria-label={tr('settings.sections.moveUp')}
                      disabled={!canUp}
                      onClick={() => move(i, -1)}
                      className="press flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-testid={`settings-section-down-${section.id}`}
                      aria-label={tr('settings.sections.moveDown')}
                      disabled={!canDown}
                      onClick={() => move(i, 1)}
                      className="press flex h-6 w-6 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-fg-faint">
                    {tr('settings.sections.pinned')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
