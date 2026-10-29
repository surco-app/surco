import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsSearchHit } from '../../lib/settingsSearch'
import type { SettingsTab } from '../../lib/settingsTabs'

function Highlighted({ hit }: { hit: SettingsSearchHit }): React.JSX.Element {
  const [range] = hit.ranges
  if (!range) return <>{hit.text}</>
  const [start, end] = range
  return (
    <>
      {hit.text.slice(0, start)}
      <mark className="rounded-sm bg-[var(--color-accent-soft)] text-inherit">
        {hit.text.slice(start, end)}
      </mark>
      {hit.text.slice(end)}
    </>
  )
}

export function SettingsSearchResults({
  query,
  groups,
  selected,
  onSelect,
}: {
  query: string
  groups: { tab: SettingsTab; hits: SettingsSearchHit[] }[]
  selected: number
  onSelect: (flatIndex: number) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const count = groups.reduce((n, g) => n + g.hits.length, 0)
  if (count === 0) {
    return (
      <div data-testid="settings-search-empty" className="flex flex-col gap-1.5 px-3 py-4">
        <p className="text-sm text-fg">
          {tr('settings.searchField.none', { query: query.trim() })}
        </p>
        <p className="text-xs leading-relaxed text-fg-dim">{tr('settings.searchField.noneHint')}</p>
      </div>
    )
  }
  let flat = 0
  return (
    <div className="flex flex-col">
      <p data-testid="settings-search-count" className="px-3 pt-1 text-[11px] text-fg-faint">
        {tr('settings.searchField.results', { count })}
      </p>
      <div
        role="listbox"
        aria-label={tr('settings.searchField.placeholder')}
        className="flex flex-col gap-0.5"
      >
        {groups.map((group) => (
          <div key={group.tab} role="presentation" className="flex flex-col gap-0.5">
            <p role="presentation" className="mt-3 mb-1 px-3 text-[11px] font-medium text-fg-faint">
              {tr(`settings.tabs.${group.tab}`)}
            </p>
            {group.hits.map((hit) => {
              const index = flat++
              const isSelected = index === selected
              return (
                <button
                  key={hit.entry.id}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-testid={`settings-search-result-${hit.entry.id}`}
                  aria-selected={isSelected}
                  onClick={() => onSelect(index)}
                  className={`flex flex-col gap-0.5 rounded-lg px-3 py-1.5 text-left text-[13px] ${
                    isSelected
                      ? 'bg-[var(--color-row-selected)] font-medium text-[var(--color-on-row-selected)]'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <span>
                    <Highlighted hit={hit} />
                  </span>
                  {hit.synonym && (
                    <span className="text-[11px] font-normal text-fg-dim">
                      {tr('settings.searchField.also', { words: hit.synonym })}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-[var(--color-line)] px-3 pt-2.5 text-[11px] leading-relaxed text-fg-faint">
        ↑ ↓ {tr('settings.searchField.keysMove')} · ↩ {tr('settings.searchField.keysOpen')} · esc{' '}
        {tr('settings.searchField.keysBack')}
      </p>
    </div>
  )
}
