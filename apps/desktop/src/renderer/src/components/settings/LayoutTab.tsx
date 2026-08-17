import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Info } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorSectionPref } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { COLUMN_HEAD, COLUMN_HEAD_CELL, TOGGLE_BOX } from '../../lib/settingsRows'
import type { PatchSynced } from '../../lib/settingsTabs'
import { Tooltip } from '../Tooltip'
import { SettingsHint, SettingsLabel, SettingsSection } from './SettingsPrimitives'

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
}

// Same table shape as Settings → Fields: the name takes the slack, then the state columns,
// then the reorder arrows. Declared tracks (not justify-between) are what let the headings
// line up with the controls, and what keeps the pinned first row on the same columns as the
// rest — it used to place its Open control wherever its "FIXED" label happened to end.
const SECTION_GRID = 'grid grid-cols-[1fr_4.75rem_4.75rem_1.75rem_1.75rem] items-center gap-1'

// Which editor sections show, in what order, and which start open — split out of the
// Editor tab (which keeps the behaviour toggles) so this reorder manager gets its own room
// instead of trailing a long scroll under the preferences.
export function LayoutTab({ synced, patch }: Props): React.JSX.Element {
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
    <SettingsSection first>
      <SettingsLabel>{tr('settings.sections.title')}</SettingsLabel>
      <SettingsHint className="mt-2 mb-3">{tr('settings.sections.hint')}</SettingsHint>
      {/* Column headings on the row grid, so each label sits over its own control. Each
          carries what its column means, asked for once here rather than repeated on every
          row — see FieldsEditor, which this list matches. */}
      <div data-testid="sections-columns" className={`${SECTION_GRID} ${COLUMN_HEAD}`}>
        <span />
        <span data-testid="sections-column-visible" role="note" className={COLUMN_HEAD_CELL}>
          {tr('settings.sections.visible')}
          <Info className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{tr('settings.sections.visibleHint')}</span>
          <Tooltip label={tr('settings.sections.visibleHint')} />
        </span>
        <span data-testid="sections-column-open" role="note" className={COLUMN_HEAD_CELL}>
          {tr('settings.sections.open')}
          <Info className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">{tr('settings.sections.openHint')}</span>
          <Tooltip label={tr('settings.sections.openHint')} />
        </span>
        <span />
        <span />
      </div>
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
              className={`${SECTION_GRID} rounded-lg border bg-[var(--color-field)] py-1.5 pr-2 ${
                movable ? 'pl-2' : 'pl-3'
              } ${
                dropId === section.id
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-line)]'
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
              {/* Hidden removes the section from the editor entirely; the form has no
                    toggle — it IS the editor. The open pill goes quiet meanwhile: a fold
                    default means nothing for a section that never renders. */}
              {movable ? (
                <button
                  type="button"
                  data-testid={`settings-section-hide-${section.id}`}
                  aria-pressed={section.hidden === true}
                  aria-label={tr(
                    section.hidden ? 'settings.sections.show' : 'settings.sections.hide',
                  )}
                  onClick={() => toggleHidden(section.id)}
                  className="mx-auto flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:text-fg"
                >
                  {section.hidden ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                  <Tooltip
                    label={tr(section.hidden ? 'settings.sections.show' : 'settings.sections.hide')}
                  />
                </button>
              ) : (
                // The metadata form IS the editor — it can't be hidden, so its cell stays
                // empty rather than holding a control that would do nothing.
                <span />
              )}
              <input
                type="checkbox"
                data-testid={`settings-section-open-${section.id}`}
                checked={section.open}
                disabled={section.hidden === true}
                onChange={() => toggleOpen(section.id)}
                aria-label={tr('settings.sections.open')}
                className={`${TOGGLE_BOX} disabled:opacity-25`}
              />
              {movable ? (
                <>
                  <button
                    type="button"
                    data-testid={`settings-section-up-${section.id}`}
                    aria-label={tr('settings.moveUp')}
                    disabled={!canUp}
                    onClick={() => move(i, -1)}
                    className="mx-auto rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-testid={`settings-section-down-${section.id}`}
                    aria-label={tr('settings.moveDown')}
                    disabled={!canDown}
                    onClick={() => move(i, 1)}
                    className="mx-auto rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                // No "FIXED" label: it sat in the arrows' columns and pushed this row's
                // Open control out of the line every other row keeps — and the row having
                // no grip and no arrows already says it doesn't move.
                <>
                  <span />
                  <span />
                </>
              )}
            </div>
          )
        })}
      </div>
    </SettingsSection>
  )
}
