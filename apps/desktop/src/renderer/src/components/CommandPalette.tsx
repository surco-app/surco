import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Command, filterCommands, filterTrackCommands } from '../lib/commands'
import type { TrackItem } from '../types'
import { ModalShell } from './ModalShell'

interface Props {
  commands: Command[]
  // The visible tracks ⌘K can jump to, and the jump itself. Searching by title/artist
  // turns the palette into a "go to track" launcher on top of the command list. Both are
  // optional and additive: without them the palette is a plain command launcher.
  tracks?: TrackItem[]
  onGoToTrack?: (id: string) => void
  // Per-command run counts (command id → count) that float a filtered list's most-used
  // entries to the top, and a callback to record one more run so the counts keep learning.
  usage?: Record<string, number>
  onRunCommand?: (id: string) => void
  onClose: () => void
}

export function CommandPalette({
  commands,
  tracks = [],
  onGoToTrack = () => {},
  usage = {},
  onRunCommand = () => {},
  onClose,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const commandResults = filterCommands(commands, query, usage)
  const trackResults = filterTrackCommands(tracks, query, onGoToTrack)
  // One flat list keeps the index-based arrow/Enter navigation untouched; the track group
  // simply starts at commandResults.length, where the "Tracks" heading is rendered.
  const results = [...commandResults, ...trackResults]
  const activeId = results[active] ? `palette-option-${results[active].id}` : undefined

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Virtual focus (aria-activedescendant) never scrolls on its own: arrowing below
  // the fold would move the highlight off-screen and Enter would run an invisible
  // command. scrollIntoView is optional-called because jsdom doesn't implement it.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId])

  function runAt(i: number): void {
    const c = results[i]
    if (c?.enabled) {
      // Only real commands count toward frecency; a track jump ("goto:<id>") is a one-off
      // navigation, not a command whose ranking should stick.
      if (!c.id.startsWith('goto:')) onRunCommand(c.id)
      c.run()
      onClose()
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="palette-backdrop"
      label={t('header.palette')}
      align="top"
      className="w-[560px] overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)]"
    >
      <input
        ref={inputRef}
        data-testid="palette-input"
        value={query}
        onChange={(e) => {
          // A new query re-filters the list, so the highlight follows it back to the
          // top — a stale index would point Enter at an arbitrary surviving command.
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls="palette-listbox"
        aria-activedescendant={activeId}
        aria-label={t('palette.placeholder')}
        placeholder={t('palette.placeholder')}
        className="w-full border-b border-[var(--color-line)] bg-transparent px-4 py-3.5 text-sm outline-none"
      />
      <div
        role="listbox"
        id="palette-listbox"
        aria-label={t('palette.placeholder')}
        className="max-h-[50vh] overflow-y-auto p-2"
      >
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-fg-dim">{t('palette.empty')}</p>
        )}
        {results.map((c, i) => (
          <div key={c.id}>
            {i === commandResults.length && trackResults.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-[0.625rem] font-medium uppercase tracking-wide text-fg-dim">
                {t('palette.tracks')}
              </p>
            )}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: options are operated from the combobox input's keydown (arrows + Enter) via aria-activedescendant, not per-row */}
            {/* biome-ignore lint/a11y/useFocusableInteractive: options use virtual focus via aria-activedescendant, so they are intentionally not tab stops */}
            <div
              role="option"
              id={`palette-option-${c.id}`}
              data-testid="palette-item"
              aria-selected={i === active}
              aria-disabled={!c.enabled}
              onClick={() => runAt(i)}
              onMouseMove={() => setActive(i)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                c.enabled ? 'cursor-pointer' : 'opacity-30'
              } ${i === active ? 'bg-[var(--color-accent-soft)]' : ''}`}
            >
              <span>{c.title}</span>
              {c.hint && <span className="ml-4 shrink-0 text-xs text-fg-dim">{c.hint}</span>}
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  )
}
