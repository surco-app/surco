import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterCommands, type Command } from '../lib/commands'

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

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    setActive(0)
  }, [query])

  function runAt(i: number): void {
    const c = results[i]
    if (c && c.enabled) {
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          data-testid="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-[var(--color-line)] bg-transparent px-4 py-3.5 text-sm outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-neutral-500">{t('palette.empty')}</li>
          )}
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                data-testid="palette-item"
                onClick={() => runAt(i)}
                onMouseMove={() => setActive(i)}
                disabled={!c.enabled}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-30 ${
                  i === active ? 'bg-[var(--color-accent-soft)]' : ''
                }`}
              >
                <span>{c.title}</span>
                {c.hint && <span className="ml-4 shrink-0 text-xs text-neutral-500">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
