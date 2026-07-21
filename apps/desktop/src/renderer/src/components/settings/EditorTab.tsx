import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorSectionPref } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { SegmentedControl } from '../SegmentedControl'
import { Tooltip } from '../Tooltip'
import { SettingsHint, SettingsLabel } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

export function EditorTab({ synced, patch }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const sections = synced.editorSections
  // Drag-to-reorder state, same pattern (and gesture) as FieldsEditor: the grip arms
  // the drag so the row's buttons stay plain clicks; arrows remain the keyboard path.
  const [dragId, setDragId] = useState<EditorSectionPref['id'] | null>(null)
  const [dropId, setDropId] = useState<EditorSectionPref['id'] | null>(null)
  const setSections = (next: EditorSectionPref[]): void => patch('editorSections', next)
  const toggleOpen = (id: EditorSectionPref['id']): void =>
    setSections(sections.map((s) => (s.id === id ? { ...s, open: !s.open } : s)))
  const toggleHidden = (id: EditorSectionPref['id']): void =>
    setSections(sections.map((s) => (s.id === id ? { ...s, hidden: s.hidden !== true } : s)))
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...sections]
    const [row] = next.splice(index, 1)
    next.splice(index + delta, 0, row)
    setSections(next)
  }
  // Dropping lands the dragged row in the target's slot — after it when dragging
  // down, before it when dragging up — matching FieldsEditor's reorder reading.
  const drop = (fromId: EditorSectionPref['id'], toId: EditorSectionPref['id']): void => {
    const from = sections.findIndex((s) => s.id === fromId)
    const to = sections.findIndex((s) => s.id === toId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...sections]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    setSections(next)
  }
  return (
    <>
      <SettingsLabel htmlFor="settings-grouping" className="mb-1.5">
        {tr('settings.grouping')}
      </SettingsLabel>
      <input
        id="settings-grouping"
        data-testid="settings-grouping"
        value={synced.grouping}
        onChange={(e) => patch('grouping', e.target.value)}
        placeholder={tr('settings.groupingPlaceholder')}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <SettingsHint className="mt-1.5 mb-5">{tr('settings.groupingHint')}</SettingsHint>

      <SettingsLabel htmlFor="settings-genre" className="mb-1.5">
        {tr('settings.genre')}
      </SettingsLabel>
      <input
        id="settings-genre"
        data-testid="settings-genre"
        value={synced.genre}
        onChange={(e) => patch('genre', e.target.value)}
        placeholder={tr('settings.genrePlaceholder')}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
      <SettingsHint className="mt-1.5 mb-5">{tr('settings.genreHint')}</SettingsHint>

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
          <SettingsHint className="mt-1.5">{tr('settings.showSpectrumHint')}</SettingsHint>
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
          <SettingsHint className="mt-1.5">{tr('settings.autoAnalyzeHint')}</SettingsHint>
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
          <SettingsHint className="mt-1.5">{tr('settings.showLoudnessHint')}</SettingsHint>
        </div>
        <div>
          <SettingsLabel className="mb-1.5">{tr('settings.keyNotation')}</SettingsLabel>
          <SegmentedControl
            options={['camelot', 'musical'] as const}
            value={synced.keyNotation}
            onChange={(id) => patch('keyNotation', id)}
            testidPrefix="settings-key-notation"
            labelFor={(id) => tr(`settings.keyNotations.${id}`)}
          />
          <SettingsHint className="mt-1.5">{tr('settings.keyNotationHint')}</SettingsHint>
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--color-line)] pt-5">
        <SettingsLabel>{tr('settings.sections.title')}</SettingsLabel>
        <SettingsHint className="mt-1.5 mb-3">{tr('settings.sections.hint')}</SettingsHint>
        <div className="space-y-1.5">
          {sections.map((section, i) => {
            const movable = section.id !== 'form'
            // Index 1 sits right under the pinned metadata form, so it can't climb.
            const canUp = movable && i > 1
            const canDown = movable && i < sections.length - 1
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: the drag handlers are a pointer-only enhancement — the arrow buttons inside remain the keyboard-accessible way to reorder (same pattern as FieldsEditor).
              <div
                key={section.id}
                data-testid={`settings-section-row-${section.id}`}
                draggable={dragId === section.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', section.id)
                }}
                onDragOver={(e) => {
                  if (dragId && movable && dragId !== section.id) {
                    e.preventDefault()
                    setDropId(section.id)
                  }
                }}
                onDragLeave={() => setDropId((k) => (k === section.id ? null : k))}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId && movable && dragId !== section.id) drop(dragId, section.id)
                  setDragId(null)
                  setDropId(null)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropId(null)
                }}
                onMouseUp={() => setDragId(null)}
                className={`flex items-center justify-between rounded-lg border bg-[var(--color-field)] py-1.5 pr-2 ${
                  movable ? 'pl-2' : 'pl-3'
                } ${
                  dropId === section.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)]'
                } ${dragId === section.id ? 'opacity-40' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-sm">
                  {movable && (
                    <GripVertical
                      data-testid={`settings-section-grip-${section.id}`}
                      onMouseDown={() => setDragId(section.id)}
                      className="h-4 w-4 shrink-0 cursor-grab text-fg-dim"
                      aria-hidden="true"
                    />
                  )}
                  <span className={`truncate ${section.hidden ? 'text-fg-dim line-through' : ''}`}>
                    {tr(`settings.sections.${section.id}`)}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Hidden removes the section from the editor entirely; the form has no
                      toggle — it IS the editor. The open pill goes quiet meanwhile: a fold
                      default means nothing for a section that never renders. */}
                  {movable && (
                    <button
                      type="button"
                      data-testid={`settings-section-hide-${section.id}`}
                      aria-pressed={section.hidden === true}
                      aria-label={tr(
                        section.hidden ? 'settings.sections.show' : 'settings.sections.hide',
                      )}
                      onClick={() => toggleHidden(section.id)}
                      className="rounded px-1.5 py-0.5 text-fg-muted hover:text-fg"
                    >
                      {section.hidden ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                      <Tooltip
                        label={tr(
                          section.hidden ? 'settings.sections.show' : 'settings.sections.hide',
                        )}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`settings-section-open-${section.id}`}
                    aria-pressed={section.open}
                    disabled={section.hidden === true}
                    onClick={() => toggleOpen(section.id)}
                    className={`mr-1 rounded px-2 py-0.5 text-xs disabled:opacity-25 ${
                      section.open
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'
                    }`}
                  >
                    {tr('settings.sections.open')}
                  </button>
                  {movable ? (
                    <>
                      <button
                        type="button"
                        data-testid={`settings-section-up-${section.id}`}
                        aria-label={tr('settings.moveUp')}
                        disabled={!canUp}
                        onClick={() => move(i, -1)}
                        className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        data-testid={`settings-section-down-${section.id}`}
                        aria-label={tr('settings.moveDown')}
                        disabled={!canDown}
                        onClick={() => move(i, 1)}
                        className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <span className="px-1.5 text-[10px] uppercase tracking-wider text-fg-faint">
                      {tr('settings.sections.pinned')}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
