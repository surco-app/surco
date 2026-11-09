import { Search } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistRole, SessionHarmony } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { foldText } from '../lib/normalizeText'
import { PlaylistRolePicker } from './PlaylistRolePicker'
import { flattenPlaylists } from './SourceTree'

const CHIP = 'press rounded-full border px-3 py-1 text-sm'
const CHIP_ON =
  'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-on-accent)]'
const CHIP_OFF =
  'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg'

const PRESETS: readonly { minutes: number; key: string }[] = [
  { minutes: 60, key: 'm60' },
  { minutes: 90, key: 'm90' },
  { minutes: 120, key: 'h2' },
  { minutes: 180, key: 'h3' },
]

const ROLES: readonly PlaylistRole[] = ['base', 'vocal', 'any', 'set']
const MAX_HITS = 8

export function isPresetMinutes(minutes: number): boolean {
  return PRESETS.some((preset) => preset.minutes === minutes)
}

export function wholeMinutes(text: string): number | null {
  return /^[1-9]\d*$/.test(text.trim()) ? Number(text.trim()) : null
}

export function DurationStep({
  minutes,
  custom,
  onPreset,
  onCustomOpen,
  onCustomText,
}: {
  minutes: number
  custom: string | null
  onPreset: (minutes: number) => void
  onCustomOpen: () => void
  onCustomText: (text: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const invalid = custom !== null && wholeMinutes(custom) === null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.minutes}
            type="button"
            data-testid={`session-wizard-duration-${preset.minutes}`}
            aria-pressed={custom === null && minutes === preset.minutes}
            onClick={() => onPreset(preset.minutes)}
            className={`${CHIP} ${custom === null && minutes === preset.minutes ? CHIP_ON : CHIP_OFF}`}
          >
            {tr(`sessions.wizard.duration.${preset.key}`)}
          </button>
        ))}
        <button
          type="button"
          data-testid="session-wizard-duration-custom"
          aria-pressed={custom !== null}
          onClick={onCustomOpen}
          className={`${CHIP} ${custom !== null ? CHIP_ON : CHIP_OFF}`}
        >
          {tr('sessions.wizard.duration.other')}
        </button>
      </div>
      {custom !== null && (
        <label className="flex flex-col gap-1 text-xs text-fg-dim">
          {tr('sessions.wizard.duration.customLabel')}
          <input
            type="text"
            inputMode="numeric"
            data-testid="session-wizard-custom"
            value={custom}
            onChange={(e) => onCustomText(e.target.value)}
            aria-invalid={invalid}
            className="w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg outline-none focus:border-[var(--color-accent)]"
          />
          {invalid && (
            <span data-testid="session-wizard-custom-invalid" className="text-warn">
              {tr('sessions.wizard.duration.customInvalid')}
            </span>
          )}
        </label>
      )}
    </div>
  )
}

export function SourcesStep({
  tree,
  roles,
  sources,
  onPick,
  onDrop,
}: {
  tree: readonly SourceNode[]
  roles: Readonly<Record<string, PlaylistRole>>
  sources: readonly string[]
  onPick: (id: string, role: PlaylistRole | null) => void
  onDrop: (id: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const playlists = useMemo(() => flattenPlaylists([...tree]), [tree])
  const byId = useMemo(() => new Map(playlists.map((p) => [p.node.id, p.node])), [playlists])
  const needle = foldText(query.trim())
  const hits = needle
    ? playlists.filter((p) => foldText(p.node.name).includes(needle)).slice(0, MAX_HITS)
    : []
  const eligible = sources.reduce((sum, id) => sum + (byId.get(id)?.count ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-dim">{tr('sessions.wizard.sources.hint')}</p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
          aria-hidden="true"
        />
        <input
          type="search"
          data-testid="session-wizard-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('sessions.wizard.sources.search', { count: playlists.length })}
          aria-label={tr('sessions.wizard.sources.search', { count: playlists.length })}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-3 pl-9 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {needle &&
        (hits.length === 0 ? (
          <p data-testid="session-wizard-no-hits" className="text-xs text-fg-dim">
            {tr('sessions.wizard.sources.noHits')}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-field)]">
            {hits.map(({ node, folders }) => (
              <li
                key={node.id}
                data-testid={`session-wizard-hit-${node.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--color-line)] px-3 py-2 first:border-t-0"
              >
                <span className="min-w-0 truncate text-[13px]">
                  {node.name}
                  <small className="ml-1.5 text-fg-faint">
                    {[...folders, tr('sessions.wizard.sources.tracks', { count: node.count })].join(
                      ' · ',
                    )}
                  </small>
                </span>
                <PlaylistRolePicker
                  value={roles[node.id] ?? null}
                  onChange={(role) => onPick(node.id, role)}
                  testIdPrefix={`session-wizard-hit-role-${node.id}`}
                />
              </li>
            ))}
          </ul>
        ))}
      {sources.length === 0 ? (
        <p data-testid="session-wizard-none" className="text-xs text-fg-dim">
          {tr('sessions.wizard.sources.none')}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((role) => {
            const ids = sources.filter((id) => roles[id] === role && byId.has(id))
            return ids.length === 0 ? null : (
              <div key={role} data-testid={`session-wizard-group-${role}`}>
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-dim uppercase">
                  {tr(`sessions.role.${role}`)}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {ids.map((id) => (
                    <span
                      key={id}
                      data-testid={`session-wizard-chip-${id}`}
                      className="flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] py-0.5 pr-1 pl-2.5 text-xs"
                    >
                      {byId.get(id)?.name}
                      <small className="text-fg-faint">{byId.get(id)?.count}</small>
                      <button
                        type="button"
                        data-testid={`session-wizard-chip-remove-${id}`}
                        aria-label={tr('sessions.wizard.sources.remove', {
                          name: byId.get(id)?.name,
                        })}
                        onClick={() => onDrop(id)}
                        className="press flex h-4 w-4 items-center justify-center rounded-full text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p data-testid="session-wizard-eligible" className="text-xs text-fg-dim">
        {tr('sessions.wizard.sources.upTo', { count: eligible })}
      </p>
    </div>
  )
}

export function FreshStep({
  tree,
  fresh,
  share,
  onAdd,
  onDrop,
  onShare,
}: {
  tree: readonly SourceNode[]
  fresh: readonly string[]
  share: number
  onAdd: (id: string) => void
  onDrop: (id: string) => void
  onShare: (share: number) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState('')
  const playlists = useMemo(() => flattenPlaylists([...tree]), [tree])
  const byId = useMemo(() => new Map(playlists.map((p) => [p.node.id, p.node])), [playlists])
  const needle = foldText(query.trim())
  const hits = needle
    ? playlists
        .filter((p) => !fresh.includes(p.node.id) && foldText(p.node.name).includes(needle))
        .slice(0, MAX_HITS)
    : []
  const percent = Math.round(share * 100)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-dim">{tr('sessions.wizard.fresh.hint')}</p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
          aria-hidden="true"
        />
        <input
          type="search"
          data-testid="session-wizard-fresh-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('sessions.wizard.fresh.search')}
          aria-label={tr('sessions.wizard.fresh.search')}
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-3 pl-9 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {needle &&
        (hits.length === 0 ? (
          <p className="text-xs text-fg-dim">{tr('sessions.wizard.sources.noHits')}</p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-field)]">
            {hits.map(({ node, folders }) => (
              <li
                key={node.id}
                className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-3 py-2 first:border-t-0"
              >
                <span className="min-w-0 truncate text-[13px]">
                  {node.name}
                  <small className="ml-1.5 text-fg-faint">
                    {[...folders, tr('sessions.wizard.sources.tracks', { count: node.count })].join(
                      ' · ',
                    )}
                  </small>
                </span>
                <button
                  type="button"
                  data-testid={`session-wizard-fresh-add-${node.id}`}
                  onClick={() => onAdd(node.id)}
                  className={`${CHIP} ${CHIP_OFF} shrink-0 py-0.5 text-xs`}
                >
                  {tr('sessions.wizard.fresh.add')}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {fresh.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fresh.map((id) => (
            <span
              key={id}
              data-testid={`session-wizard-fresh-chip-${id}`}
              className="flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] py-0.5 pr-1 pl-2.5 text-xs"
            >
              {byId.get(id)?.name}
              <small className="text-fg-faint">{byId.get(id)?.count}</small>
              <button
                type="button"
                data-testid={`session-wizard-fresh-chip-remove-${id}`}
                aria-label={tr('sessions.wizard.sources.remove', { name: byId.get(id)?.name })}
                onClick={() => onDrop(id)}
                className="press flex h-4 w-4 items-center justify-center rounded-full text-fg-faint hover:bg-[var(--color-hover)] hover:text-fg"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-xs text-fg-dim">
        <span className="flex justify-between">
          {tr('sessions.wizard.fresh.share')}
          <span className="tabular-nums text-fg">
            {tr('sessions.wizard.fresh.shareValue', { percent })}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={percent}
          disabled={fresh.length === 0}
          data-testid="session-wizard-fresh-share"
          onChange={(e) => onShare(Number(e.target.value) / 100)}
          className="accent-[var(--color-accent)] disabled:opacity-50"
        />
      </label>
    </div>
  )
}

type CharacterKey = 'alternate' | 'preferCombos' | 'tasteWeight' | 'surprise'

const CHARACTER_OPTIONS: readonly CharacterKey[] = [
  'alternate',
  'preferCombos',
  'tasteWeight',
  'surprise',
]

const HARMONIES: readonly { mode: SessionHarmony; label: string }[] = [
  { mode: 'free', label: 'harmonyFree' },
  { mode: 'neighbours', label: 'harmonyNeighbours' },
  { mode: 'same', label: 'harmonySame' },
]

export function CharacterStep({
  options,
  hasKeys,
  onChange,
}: {
  options: Record<CharacterKey, boolean> & { harmony: SessionHarmony }
  hasKeys: boolean
  onChange: (patch: Partial<Record<CharacterKey, boolean> & { harmony: SessionHarmony }>) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      {CHARACTER_OPTIONS.map((key) => (
        <label key={key} className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            data-testid={`session-wizard-opt-${key}`}
            checked={options[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="text-sm">
            {tr(`sessions.wizard.character.${key}`)}
            <span className="mt-0.5 block text-xs text-fg-dim">
              {tr(`sessions.wizard.character.${key}Hint`)}
            </span>
          </span>
        </label>
      ))}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm">{tr('sessions.wizard.character.harmony')}</span>
        <div className="flex flex-wrap gap-2">
          {HARMONIES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              data-testid={`session-wizard-harmony-${mode}`}
              aria-pressed={hasKeys && options.harmony === mode}
              disabled={!hasKeys}
              onClick={() => onChange({ harmony: mode })}
              className={`${CHIP} ${hasKeys && options.harmony === mode ? CHIP_ON : CHIP_OFF} disabled:opacity-50`}
            >
              {tr(`sessions.wizard.character.${label}`)}
            </button>
          ))}
        </div>
        {!hasKeys && (
          <p data-testid="session-wizard-no-keys" className="text-xs text-fg-dim">
            {tr('sessions.wizard.character.noKeys')}
          </p>
        )}
      </div>
    </div>
  )
}
