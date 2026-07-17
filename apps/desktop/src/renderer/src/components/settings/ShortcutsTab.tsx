import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SHORTCUT_DEFAULTS } from '../../../../shared/shortcutDefaults'
import { type Chord, chordEquals, eventToChord } from '../../../../shared/shortcuts'
import { isMacOS } from '../../lib/platform'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { formatShortcut } from '../../lib/shortcuts'
import { Tooltip } from '../Tooltip'

const isMac = isMacOS()

interface Props {
  synced: SyncedDraft
  patch: PatchSynced
  bindings: Map<string, Chord>
  conflictIds: Set<string>
}

export function ShortcutsTab({ synced, patch, bindings, conflictIds }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // The command whose next keystroke is being recorded, or null when idle.
  const [recording, setRecording] = useState<string | null>(null)

  // A command id is kebab-case ('find-replace'); its i18n title lives under the
  // camelCase key (commands.findReplace).
  const commandTitle = (id: string): string =>
    tr(`commands.${id.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())}`)

  // Records the next keystroke as the binding for `id`. A lone modifier press is ignored
  // (wait for the full chord), Escape cancels, and ⌘K stays reserved for the palette.
  function captureChord(id: string, e: React.KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return
    }
    const chord = eventToChord(e, isMac)
    if (!chord || chordEquals(chord, ['mod', 'k'])) return
    patch('shortcutOverrides', { ...synced.shortcutOverrides, [id]: chord })
    setRecording(null)
  }

  function resetRow(id: string): void {
    const rest = { ...synced.shortcutOverrides }
    delete rest[id]
    patch('shortcutOverrides', rest)
  }

  return (
    <div className="min-h-[280px]">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-fg-dim">{tr('settings.shortcuts.intro')}</p>
        <button
          type="button"
          data-testid="shortcuts-reset-all"
          onClick={() => patch('shortcutOverrides', {})}
          className="press shrink-0 text-xs text-fg-muted hover:text-fg"
        >
          {tr('settings.shortcuts.resetAll')}
        </button>
      </div>
      <div>
        {SHORTCUT_DEFAULTS.map((def) => {
          const chord = bindings.get(def.id) ?? []
          const overridden = def.id in synced.shortcutOverrides
          const isRecording = recording === def.id
          return (
            <div
              key={def.id}
              data-testid={`shortcut-row-${def.id}`}
              className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] py-2 last:border-b-0"
            >
              <span className="text-sm text-fg">{commandTitle(def.id)}</span>
              <div className="flex items-center gap-2">
                {overridden && (
                  <button
                    type="button"
                    data-testid={`shortcut-reset-${def.id}`}
                    onClick={() => resetRow(def.id)}
                    className="press text-sm text-fg-faint hover:text-fg"
                  >
                    ↺
                    <Tooltip label={tr('settings.shortcuts.reset')} />
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`shortcut-record-${def.id}`}
                  onClick={() => setRecording(isRecording ? null : def.id)}
                  onKeyDown={isRecording ? (e) => captureChord(def.id, e) : undefined}
                  onBlur={() => isRecording && setRecording(null)}
                  aria-pressed={isRecording}
                  className={`press min-w-[6rem] rounded-md border px-2.5 py-1 text-center font-mono text-xs ${
                    isRecording
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : conflictIds.has(def.id)
                        ? 'border-danger text-danger'
                        : 'border-[var(--color-line-strong)] text-fg-muted hover:text-fg'
                  }`}
                >
                  {isRecording
                    ? tr('settings.shortcuts.recording')
                    : chord.length
                      ? formatShortcut(chord, isMac)
                      : tr('settings.shortcuts.unbound')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {/* The list/Discogs navigation keys are fixed (vim-style j/k, arrows, Home/End, Page
          Up/Down), so they don't get an editable row above — name them here so they're still
          discoverable rather than hidden. */}
      <p data-testid="shortcuts-fixed-nav" className="mt-3 text-xs text-fg-dim">
        {tr('settings.shortcuts.fixedNav')}
      </p>
      {conflictIds.size > 0 && (
        <p data-testid="shortcuts-conflict" className="mt-3 text-xs text-danger">
          {tr('settings.shortcuts.conflict')}
        </p>
      )}
    </div>
  )
}
