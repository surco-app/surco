import type React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistRole, SessionHarmony } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { playlistOptions } from '../lib/rekordboxPlaylists'
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
}: {
  tree: readonly SourceNode[]
  roles: Readonly<Record<string, PlaylistRole>>
  sources: readonly string[]
  onPick: (id: string, role: PlaylistRole | null) => void
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
  const [only, setOnly] = useState(false)
  const chosen = sources.filter((id) => byId.has(id))
  const onlyIds = only && chosen.length > 0 ? new Set(chosen) : undefined
  const eligible = chosen.reduce((sum, id) => sum + (byId.get(id)?.count ?? 0), 0)
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
          autoFocus={false}
          emptyText={tr('sessions.wizard.sources.noHits')}
          searchLabel={tr('sessions.wizard.sources.search', { count: playlists.length })}
          onlyIds={onlyIds}
          control={({ id }) =>
            id ? (
              <PlaylistRolePicker
                value={roles[id] ?? null}
                onChange={(role) => onPick(id, role)}
                testIdPrefix={`session-wizard-role-${id}`}
              />
            ) : null
          }
        />
      </div>
      {chosen.length === 0 ? (
        <p data-testid="session-wizard-none" className="text-xs text-fg-dim">
          {tr('sessions.wizard.sources.none')}
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 text-xs text-fg-dim">
          <p data-testid="session-wizard-summary">
            {tr('sessions.wizard.sources.summary', { count: chosen.length, tracks: eligible })}
          </p>
          <button
            type="button"
            data-testid="session-wizard-only-chosen"
            aria-pressed={only}
            onClick={() => setOnly((value) => !value)}
            className="press shrink-0 rounded-md px-2 py-1 text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
          >
            {tr(only ? 'sessions.wizard.sources.allPlaylists' : 'sessions.wizard.sources.onlyChosen')}
          </button>
        </div>
      )}
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
  playMinutes,
  onPlayMinutes,
  hasNew,
  freshShare,
  onFreshShare,
  onChange,
}: {
  options: Record<CharacterKey, boolean> & { harmony: SessionHarmony }
  hasKeys: boolean
  playMinutes: number
  onPlayMinutes: (minutes: number) => void
  hasNew: boolean
  freshShare: number
  onFreshShare: (share: number) => void
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
      <label className="flex flex-col gap-1.5 text-sm">
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
          onChange={(e) => onPlayMinutes(Number(e.target.value))}
          className="accent-[var(--color-accent)]"
        />
        <span data-testid="session-wizard-play-hint" className="text-xs text-fg-dim">
          {tr('sessions.wizard.character.playHint')}
        </span>
      </label>
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
            onChange={(e) => onFreshShare(Number(e.target.value) / 100)}
            className="accent-[var(--color-accent)]"
          />
          <span data-testid="session-wizard-fresh-hint" className="text-xs text-fg-dim">
            {tr('sessions.wizard.fresh.hint')}
          </span>
        </label>
      )}
      <div className="flex flex-col gap-1.5">
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
