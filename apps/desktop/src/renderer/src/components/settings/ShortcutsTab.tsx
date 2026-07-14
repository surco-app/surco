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

// The beatgrid lane's claimed keys, in the order the work uses them. Listed, not
// editable: a claim is only live while its section is open, so it has no global
// binding to record over.
const LANE_SHORTCUTS: { key: string; i18n: string }[] = [
  { key: 'Space', i18n: 'settings.shortcuts.laneAudition' },
  { key: 'C', i18n: 'settings.shortcuts.laneCentre' },
  { key: 'G', i18n: 'settings.shortcuts.laneAddSegment' },
  { key: '[', i18n: 'settings.shortcuts.lanePrevSeam' },
  { key: ']', i18n: 'settings.shortcuts.laneNextSeam' },
]

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
      {/* The beatgrid lane's own keys. They are not rebindable commands but
          CLAIMS: bare keys that only act while the section is open, and hand
          back to the global bindings the moment it closes (a bare G is free for
          the list again). So they get no capture button — but they are the keys
          the grid work is actually done with, and until now the only place they
          were named was the tooltip of the button they double for, which is
          exactly where nobody looks for a shortcut. */}
      <div data-testid="shortcuts-lane" className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-fg-muted">
          {tr('settings.shortcuts.laneTitle')}
        </p>
        <div className="rounded-md border border-[var(--color-line)]">
          {LANE_SHORTCUTS.map(({ key, i18n }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-2.5 py-1.5 last:border-b-0"
            >
              <span className="text-xs text-fg-muted">{tr(i18n)}</span>
              <span className="shrink-0 rounded border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
                {key}
              </span>
            </div>
          ))}
        </div>
      </div>
      {conflictIds.size > 0 && (
        <p data-testid="shortcuts-conflict" className="mt-3 text-xs text-danger">
          {tr('settings.shortcuts.conflict')}
        </p>
      )}
    </div>
  )
}
