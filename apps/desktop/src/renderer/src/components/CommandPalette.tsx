import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Command, filterCommands } from '../lib/commands'
import { ModalShell } from './ModalShell'

interface Props {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = filterCommands(commands, query)
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
          // biome-ignore lint/a11y/useKeyWithClickEvents: options are operated from the combobox input's keydown (arrows + Enter) via aria-activedescendant, not per-row
          // biome-ignore lint/a11y/useFocusableInteractive: options use virtual focus via aria-activedescendant, so they are intentionally not tab stops
          <div
            key={c.id}
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
        ))}
      </div>
    </ModalShell>
  )
}
