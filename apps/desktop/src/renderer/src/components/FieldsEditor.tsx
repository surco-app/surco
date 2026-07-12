import { Check, ChevronDown, ChevronUp, GripVertical, Wand2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from './Tooltip'
import { FIELD_DEFS, moveItem, sortFieldsByGroup } from '../lib/fields'

// How long the auto-organize button holds its "done" confirmation before reverting.
const ORGANIZED_FEEDBACK_MS = 1500

// Moves fromKey to toKey's slot: dragging down lands it after the target, dragging up
// before it — how every list DnD reads, so the row stays where the user dropped it.
function reorder(list: string[], fromKey: string, toKey: string): string[] {
  const from = list.indexOf(fromKey)
  const to = list.indexOf(toKey)
  if (from === -1 || to === -1 || from === to) return list
  const next = [...list]
  next.splice(from, 1)
  next.splice(to, 0, fromKey)
  return next
}

interface Props {
  visibleFields: string[]
  requiredFields: string[]
  onChangeVisible: (next: string[]) => void
  onChangeRequired: (next: string[]) => void
}

// The editor's field list: which tags show (and in what order) and which must be filled
// before a track converts. Shared by Settings → Fields and the onboarding wizard so the
// two can't drift. Required implies shown, so hiding a field also drops it from required.
export function FieldsEditor({
  visibleFields,
  requiredFields,
  onChangeVisible,
  onChangeRequired,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Reordering a scrolling (and possibly already-tidy) list gives no visible sign it ran,
  // so the button confirms in place, then reverts. The timer is cleared on unmount so a
  // late revert can't fire after the modal closes.
  const [organized, setOrganized] = useState(false)
  // Drag-to-reorder state: the row being dragged (armed from its grip handle, so the
  // row's buttons stay plain clicks) and the row currently hovered as the drop target.
  // The arrow buttons remain as the keyboard-accessible path.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const organizedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(organizedTimer.current), [])
  function autoOrganize(): void {
    onChangeVisible(sortFieldsByGroup(visibleFields))
    setOrganized(true)
    clearTimeout(organizedTimer.current)
    organizedTimer.current = setTimeout(() => setOrganized(false), ORGANIZED_FEEDBACK_MS)
  }
  return (
    <div className="max-h-[340px] space-y-4 overflow-y-auto pr-1">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-dim">
            {tr('settings.shown')}
          </p>
          <button
            type="button"
            data-testid="auto-organize-fields"
            onClick={autoOrganize}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              organized
                ? 'text-[var(--color-accent)]'
                : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
            }`}
          >
            {organized ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {tr(organized ? 'settings.autoOrganized' : 'settings.autoOrganize')}
            <Tooltip label={tr('settings.autoOrganizeHint')} />
          </button>
        </div>
        <div className="space-y-1.5">
          {visibleFields.map((key, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: the drag handlers are a pointer-only enhancement — the arrow buttons inside remain the keyboard-accessible way to reorder.
            <div
              key={key}
              data-testid={`field-row-${key}`}
              draggable={dragKey === key}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', key)
              }}
              onDragOver={(e) => {
                if (dragKey && dragKey !== key) {
                  e.preventDefault()
                  setDropKey(key)
                }
              }}
              onDragLeave={() => setDropKey((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragKey && dragKey !== key) onChangeVisible(reorder(visibleFields, dragKey, key))
                setDragKey(null)
                setDropKey(null)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setDropKey(null)
              }}
              onMouseUp={() => setDragKey(null)}
              className={`flex items-center justify-between rounded-lg border bg-[var(--color-field)] py-1.5 pl-2 pr-2 ${
                dropKey === key ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)]'
              } ${dragKey === key ? 'opacity-40' : ''}`}
            >
              <span className="flex items-center gap-1.5 text-sm">
                <GripVertical
                  data-testid={`field-grip-${key}`}
                  onMouseDown={() => setDragKey(key)}
                  className="h-4 w-4 cursor-grab text-fg-dim"
                  aria-hidden="true"
                />
                {tr(`fields.${key}`)}
                <Tooltip label={`{${key}}`} />
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid={`field-required-${key}`}
                  aria-pressed={requiredFields.includes(key)}
                  onClick={() =>
                    onChangeRequired(
                      requiredFields.includes(key)
                        ? requiredFields.filter((k) => k !== key)
                        : [...requiredFields, key],
                    )
                  }
                  className={`mr-1 rounded px-2 py-0.5 text-xs ${
                    requiredFields.includes(key)
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'
                  }`}
                >
                  {tr('settings.required')}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeVisible(moveItem(visibleFields, i, -1))}
                  disabled={i === 0}
                  className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  aria-label={tr('settings.moveUp')}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onChangeVisible(moveItem(visibleFields, i, 1))}
                  disabled={i === visibleFields.length - 1}
                  className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-25"
                  aria-label={tr('settings.moveDown')}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeVisible(visibleFields.filter((k) => k !== key))
                    onChangeRequired(requiredFields.filter((k) => k !== key))
                  }}
                  className="ml-1 rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
                >
                  {tr('settings.hide')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-dim">
          {tr('settings.hidden')}
        </p>
        <div className="space-y-1.5">
          {/* The visible list keeps the user's order (it IS the editor's order); the
              hidden list has none of its own, so it sorts by label for scanning. */}
          {FIELD_DEFS.filter((d) => !visibleFields.includes(d.key))
            .sort((a, b) => tr(`fields.${a.key}`).localeCompare(tr(`fields.${b.key}`)))
            .map((d) => (
              <div
                key={d.key}
                data-testid={`hidden-field-${d.key}`}
                className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-1.5 pl-3 pr-2"
              >
                <span className="text-sm text-fg-muted">
                  {tr(`fields.${d.key}`)}
                  <Tooltip label={`{${d.key}}`} />
                </span>
                <button
                  type="button"
                  onClick={() => onChangeVisible([...visibleFields, d.key])}
                  className="rounded px-2 py-0.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
                >
                  {tr('settings.show')}
                </button>
              </div>
            ))}
          {FIELD_DEFS.every((d) => visibleFields.includes(d.key)) && (
            <p className="text-xs text-fg-faint">{tr('settings.allVisible')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
