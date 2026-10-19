import { X } from 'lucide-react'
import type React from 'react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RekordboxPlaylistTarget } from '../../../shared/types'
import {
  canCreate,
  matchingOptions,
  type PlaylistOption,
  targetKey,
} from '../lib/rekordboxPlaylists'
import { RekordboxIcon } from './SourceIcons'

const MAX_OPTIONS = 8

interface Token {
  target: RekordboxPlaylistTarget
  state: 'all' | 'some'
}

function Picker({
  inputId,
  options,
  chosen,
  onPick,
  onBackspace,
}: {
  inputId: string
  options: readonly PlaylistOption[]
  chosen: readonly RekordboxPlaylistTarget[]
  onPick: (target: RekordboxPlaylistTarget) => void
  onBackspace?: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const matches =
    text.trim() === '' ? [] : matchingOptions(options, text, chosen).slice(0, MAX_OPTIONS)
  const rows: RekordboxPlaylistTarget[] = [
    ...matches.map((o) => ({ id: o.id, name: o.name })),
    ...(canCreate(options, text, chosen) ? [{ name: text.trim() }] : []),
  ]
  const pick = (target: RekordboxPlaylistTarget): void => {
    onPick(target)
    setText('')
    setActive(0)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault()
      pick(rows[active])
    } else if (e.key === 'Escape') setText('')
    else if (e.key === 'Backspace' && text === '') onBackspace?.()
  }
  return (
    <div className="relative min-w-[8rem] flex-1">
      <input
        id={inputId}
        data-testid="playlists-input"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={rows.length > 0 ? `${listId}-${active}` : undefined}
        value={text}
        placeholder={tr('editor.playlists.placeholder')}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        className="w-full bg-transparent py-0.5 text-sm text-fg outline-none placeholder:text-fg-faint"
      />
      {rows.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label={tr('editor.playlists.options')}
          className="absolute top-full left-0 z-20 mt-1 max-h-64 w-72 overflow-auto rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] py-1 shadow-[var(--shadow-float)]"
        >
          {rows.map((row, i) => {
            const path = row.id ? options.find((o) => o.id === row.id)?.path : undefined
            return (
              <button
                key={targetKey(row)}
                type="button"
                role="option"
                id={`${listId}-${i}`}
                tabIndex={-1}
                aria-selected={i === active}
                data-testid={row.id ? `playlists-option-${row.id}` : 'playlists-create'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(row)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-2.5 py-1 text-left text-xs ${
                  i === active ? 'bg-[var(--color-hover)] text-fg' : 'text-fg-muted'
                }`}
              >
                <span className="truncate">
                  {row.id ? row.name : tr('editor.playlists.create', { name: row.name })}
                </span>
                {path && (
                  <span className="ml-auto shrink-0 truncate text-[10px] text-fg-faint">
                    {path}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TokenChip({
  token,
  path,
  onRemove,
  onComplete,
}: {
  token: Token
  path: string
  onRemove: () => void
  onComplete?: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const key = targetKey(token.target)
  const pending = !token.target.id
  const loose = pending || token.state === 'some'
  return (
    <span
      data-testid={`playlists-token-${key}`}
      data-state={token.state}
      data-pending={pending ? 'true' : undefined}
      title={
        pending
          ? tr('editor.playlists.pending')
          : token.state === 'some'
            ? tr('editor.playlists.some')
            : path || undefined
      }
      className={`inline-flex max-w-full items-center gap-0.5 rounded-full border py-0.5 pr-0.5 pl-2 text-[11px] ${
        loose
          ? 'border-dashed border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)] text-[var(--color-accent)]'
          : 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-fg'
      }`}
    >
      {onComplete ? (
        <button
          type="button"
          data-testid={`playlists-token-complete-${key}`}
          onClick={onComplete}
          className="truncate"
        >
          {token.target.name}
        </button>
      ) : (
        <span className="truncate">{token.target.name}</span>
      )}
      <button
        type="button"
        data-testid={`playlists-token-remove-${key}`}
        aria-label={tr('editor.playlists.remove', { name: token.target.name })}
        onClick={onRemove}
        className="press rounded-full p-0.5 text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}

function Shell({
  label,
  inputId,
  testId,
  children,
}: {
  label: string
  inputId: string
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div data-testid={testId} className="group block @[24rem]:contents">
      <label
        htmlFor={inputId}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-dim @[24rem]:col-start-1 @[24rem]:mb-0 @[24rem]:min-h-[34px] @[24rem]:max-w-32 @[24rem]:flex-row-reverse @[24rem]:justify-start @[24rem]:text-right"
      >
        {label}
        <RekordboxIcon size={12} />
      </label>
      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)]/30 px-2 py-1 focus-within:border-[var(--color-accent)] @[24rem]:col-start-2">
        {children}
      </div>
    </div>
  )
}

const pathOf = (options: readonly PlaylistOption[], target: RekordboxPlaylistTarget): string =>
  (target.id && options.find((o) => o.id === target.id)?.path) || ''

export function PlaylistsField({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: PlaylistOption[]
  value: RekordboxPlaylistTarget[]
  onChange: (next: RekordboxPlaylistTarget[]) => void
}): React.JSX.Element {
  const inputId = useId()
  return (
    <Shell label={label} inputId={inputId} testId="playlists-field">
      {value.map((target) => (
        <TokenChip
          key={targetKey(target)}
          token={{ target, state: 'all' }}
          path={pathOf(options, target)}
          onRemove={() => onChange(value.filter((t) => targetKey(t) !== targetKey(target)))}
        />
      ))}
      <Picker
        inputId={inputId}
        options={options}
        chosen={value}
        onPick={(target) => onChange([...value, target])}
        onBackspace={() => {
          if (value.length > 0) onChange(value.slice(0, -1))
        }}
      />
    </Shell>
  )
}

export function PlaylistsBulkField({
  label,
  options,
  states,
  onToggle,
}: {
  label: string
  options: PlaylistOption[]
  states: Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
}): React.JSX.Element {
  const inputId = useId()
  return (
    <Shell label={label} inputId={inputId} testId="playlists-bulk">
      {states.map((token) => (
        <TokenChip
          key={targetKey(token.target)}
          token={token}
          path={pathOf(options, token.target)}
          onRemove={() => onToggle(token.target, false)}
          onComplete={token.state === 'some' ? () => onToggle(token.target, true) : undefined}
        />
      ))}
      <Picker
        inputId={inputId}
        options={options}
        chosen={states.map((s) => s.target)}
        onPick={(target) => onToggle(target, true)}
      />
    </Shell>
  )
}
