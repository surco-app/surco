import type React from 'react'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistRole, SessionHarmony } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { playlistOptions } from '../lib/rekordboxPlaylists'
import { playlistIdsUnder } from './CheckTree'
import { PlaylistRolePicker } from './PlaylistRolePicker'
import { PlaylistTree } from './PlaylistTree'
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

const NO_TOGGLE = (): void => undefined

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
  playMinutes,
  onPlayMinutes,
}: {
  minutes: number
  custom: string | null
  onPreset: (minutes: number) => void
  onCustomOpen: () => void
  onCustomText: (text: string) => void
  playMinutes: number
  onPlayMinutes: (minutes: number) => void
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
            className="w-28 rounded-lg border border-[var(--color-input-border)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg outline-none focus:border-[var(--color-accent)]"
          />
          {invalid && (
            <span data-testid="session-wizard-custom-invalid" className="text-warn">
              {tr('sessions.wizard.duration.customInvalid')}
            </span>
          )}
        </label>
      )}
      <label className="flex flex-col gap-1.5 mt-2 border-t border-[var(--color-line)] pt-4 text-sm">
        <span className="flex justify-between">
          {tr('sessions.wizard.character.play')}
          <span data-testid="session-wizard-play-value" className="tabular-nums text-fg">
            {tr('sessions.wizard.character.playValue', { minutes: playMinutes })}
          </span>
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={playMinutes}
          data-testid="session-wizard-play"
          aria-valuetext={tr('sessions.wizard.character.playValue', { minutes: playMinutes })}
          onChange={(e) => onPlayMinutes(Number(e.target.value))}
          className="accent-[var(--color-accent)]"
        />
        <span data-testid="session-wizard-play-hint" className="text-xs text-fg-dim">
          {tr('sessions.wizard.character.playHint')}
        </span>
      </label>
      <p
        data-testid="session-wizard-track-count"
        className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 text-xs text-fg-dim"
      >
        {tr('sessions.wizard.duration.tracks', {
          count: Math.ceil(minutes / playMinutes),
          minutes,
        })}
      </p>
    </div>
  )
}

export function SourcesStep({
  tree,
  roles,
  sources,
  onPick,
  onPickMany,
  only,
  onOnly,
}: {
  tree: readonly SourceNode[]
  roles: Readonly<Record<string, PlaylistRole>>
  sources: readonly string[]
  onPick: (id: string, role: PlaylistRole | null) => void
  onPickMany: (roles: Readonly<Record<string, PlaylistRole | null>>) => void
  only: boolean
  onOnly: (only: boolean) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const playlists = useMemo(() => flattenPlaylists([...tree]), [tree])
  const byId = useMemo(() => new Map(playlists.map((p) => [p.node.id, p.node])), [playlists])
  const options = useMemo(() => playlistOptions(tree), [tree])
  const tokens = useMemo(
    () =>
      sources.flatMap((id) => {
        const node = byId.get(id)
        return node ? [{ target: { id, name: node.name }, state: 'all' as const }] : []
      }),
    [sources, byId],
  )
  const chosen = sources.filter((id) => byId.has(id))
  const onlyIds = only && chosen.length > 0 ? new Set(chosen) : undefined
  return (
    <div className="flex flex-col gap-3">
      <p data-testid="session-wizard-sources-hint" className="text-xs text-fg-dim">
        {tr('sessions.wizard.sources.hint')}
      </p>
      <div className="flex flex-col overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-field)]">
        <PlaylistTree
          tree={tree}
          options={options}
          tokens={tokens}
          onToggle={NO_TOGGLE}
          allowCreate={false}
          emptyText={tr('sessions.wizard.sources.noHits')}
          searchLabel={tr('sessions.wizard.sources.search', { count: playlists.length })}
          onlyIds={onlyIds}
          onRowKey={(key, row) => {
            const role = KEY_ROLES[key]
            if (!role) return false
            const ids =
              'node' in row ? playlistIdsUnder(row.node) : row.target.id ? [row.target.id] : []
            const on = ids.length > 0 && ids.every((id) => roles[id] === role)
            onPickMany(Object.fromEntries(ids.map((id) => [id, on ? null : role])))
            return true
          }}
          folderControl={(node) => {
            const ids = playlistIdsUnder(node)
            const first = ids.length > 0 ? roles[ids[0]] : undefined
            const same = first !== undefined && ids.every((id) => roles[id] === first)
            return ids.length > 0 ? (
              <PlaylistRolePicker
                name={node.name}
                value={same ? first : null}
                onChange={(role) => onPickMany(Object.fromEntries(ids.map((id) => [id, role])))}
                testIdPrefix={`session-wizard-folder-role-${node.id}`}
              />
            ) : null
          }}
          control={({ id, name }) =>
            id ? (
              <PlaylistRolePicker
                name={name}
                value={roles[id] ?? null}
                onChange={(role) => onPick(id, role)}
                testIdPrefix={`session-wizard-role-${id}`}
              />
            ) : null
          }
        />
      </div>
      {chosen.length > 0 && (
        <button
          type="button"
          data-testid="session-wizard-only-chosen"
          aria-pressed={only}
          onClick={() => onOnly(!only)}
          className="press self-end rounded-md px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
        >
          {tr(only ? 'sessions.wizard.sources.allPlaylists' : 'sessions.wizard.sources.onlyChosen')}
        </button>
      )}
    </div>
  )
}

export function SourcesReach({
  tree,
  sources,
  minutes,
  playMinutes,
}: {
  tree: readonly SourceNode[]
  sources: readonly string[]
  minutes: number
  playMinutes: number
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const counts = useMemo(
    () => new Map(flattenPlaylists([...tree]).map((p) => [p.node.id, p.node.count])),
    [tree],
  )
  const chosen = sources.filter((id) => counts.has(id))
  if (chosen.length === 0)
    return (
      <p data-testid="session-wizard-none" className="text-xs text-fg-dim">
        {tr('sessions.wizard.sources.none')}
      </p>
    )
  const eligible = chosen.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0)
  const reach = eligible * playMinutes
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-xs text-fg-dim">
      <p data-testid="session-wizard-summary">
        {tr('sessions.wizard.sources.summary', { count: chosen.length, tracks: eligible })}
      </p>
      <p data-testid="session-wizard-length" className={reach < minutes ? 'text-warn' : undefined}>
        {reach < minutes
          ? tr('sessions.wizard.sources.short', { minutes: reach, target: minutes })
          : tr('sessions.wizard.sources.enough', { target: minutes })}
      </p>
    </div>
  )
}

const KEY_ROLES: Readonly<Record<string, PlaylistRole>> = { '1': 'base', '2': 'vocal', '3': 'any' }

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
  hasNew,
  hasMixed,
  freshShare,
  onFreshShare,
  onChange,
}: {
  options: Record<CharacterKey, boolean> & { harmony: SessionHarmony }
  hasKeys: boolean
  hasNew: boolean
  hasMixed: boolean
  freshShare: number
  onFreshShare: (share: number) => void
  onChange: (patch: Partial<Record<CharacterKey, boolean> & { harmony: SessionHarmony }>) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      {CHARACTER_OPTIONS.map((key) => (
        <Fragment key={key}>
          <label className="flex cursor-pointer items-start gap-3">
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
          {key === 'preferCombos' && options.preferCombos && !hasMixed && (
            <p
              data-testid="session-wizard-combos-hint"
              className="-mt-1.5 pl-7 text-xs text-fg-dim"
            >
              {tr('sessions.wizard.character.noMixed')}
            </p>
          )}
        </Fragment>
      ))}
      {hasNew && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex justify-between">
            {tr('sessions.wizard.fresh.share')}
            <span className="tabular-nums text-fg">
              {tr('sessions.wizard.fresh.shareValue', { percent: Math.round(freshShare * 100) })}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={Math.round(freshShare * 100)}
            data-testid="session-wizard-fresh-share"
            aria-valuetext={tr('sessions.wizard.fresh.shareValue', {
              percent: Math.round(freshShare * 100),
            })}
            onChange={(e) => onFreshShare(Number(e.target.value) / 100)}
            className="accent-[var(--color-accent)]"
          />
          <span data-testid="session-wizard-fresh-hint" className="text-xs text-fg-dim">
            {tr('sessions.wizard.fresh.hint')}
          </span>
        </label>
      )}
      <div className="flex flex-col gap-1.5 border-t border-[var(--color-line)] pt-3">
        <span data-testid="session-wizard-harmony-title" className="text-sm">
          {tr('sessions.wizard.character.harmony')}
        </span>
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
