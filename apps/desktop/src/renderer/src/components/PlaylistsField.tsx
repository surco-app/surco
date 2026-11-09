import { ChevronDown } from 'lucide-react'
import type React from 'react'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistLibrary, RekordboxPlaylistTarget, SourceNode } from '../../../shared/types'
import type { PlaylistsDisabled } from '../lib/fieldSpecs'
import { type PopoverPlacement, popoverPlacement } from '../lib/popoverPlacement'
import { type PlaylistOption, targetKey } from '../lib/rekordboxPlaylists'
import { SOURCE_PROGRAMS } from '../lib/sourcePrograms'
import { playlistIdsUnder } from './CheckTree'
import { chosenIdsOf, PlaylistTree, type Token } from './PlaylistTree'
import { LIBRARY_ICON } from './SourceIcons'
import { Tooltip } from './Tooltip'

const fieldTestId = (library: PlaylistLibrary, testId: string): string =>
  `${SOURCE_PROGRAMS[library].fieldTestIdPrefix}${testId}`

const POPOVER_GAP = 12

function visibleAreaOf(el: HTMLElement): { top: number; bottom: number } {
  for (let at = el.parentElement; at; at = at.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(at).overflowY)) return at.getBoundingClientRect()
  }
  return { top: 0, bottom: window.innerHeight }
}

function whereParts(
  tree: readonly SourceNode[],
  tokens: readonly Token[],
): { key: string; text: string; pending: boolean }[] {
  const ids = chosenIdsOf(tokens)
  const folders = tree.flatMap((node) => {
    if (!node.children?.length) return []
    const k = playlistIdsUnder(node).filter((id) => ids.has(id)).length
    if (k === 0) return []
    return [{ key: node.id, text: k > 1 ? `${node.name} (${k})` : node.name, pending: false }]
  })
  const roots = tree.flatMap((node) =>
    node.kind === 'playlist' && !node.children?.length && ids.has(node.id)
      ? [{ key: node.id, text: node.name, pending: false }]
      : [],
  )
  const pending = tokens.flatMap((t) =>
    t.target.id ? [] : [{ key: targetKey(t.target), text: t.target.name, pending: true }],
  )
  return [...folders, ...roots, ...pending]
}

function TreePopover({
  app,
  tree,
  options,
  tokens,
  onToggle,
  onClose,
}: {
  app: string
  tree: readonly SourceNode[]
  options: readonly PlaylistOption[]
  tokens: readonly Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
  onClose: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<PopoverPlacement | null>(null)
  useLayoutEffect(() => {
    const box = boxRef.current
    const field = box?.parentElement
    if (!box || !field) return
    const at = field.getBoundingClientRect()
    const area = visibleAreaOf(field)
    setPlace(
      popoverPlacement({
        above: at.top - area.top - POPOVER_GAP,
        below: area.bottom - at.bottom - POPOVER_GAP,
        height: box.offsetHeight,
      }),
    )
  }, [])
  return (
    <div
      ref={boxRef}
      data-testid="playlists-popover"
      data-side={place?.side ?? 'down'}
      role="dialog"
      aria-label={tr('editor.playlists.options', { app })}
      style={{ maxHeight: place?.maxHeight }}
      className={`absolute right-0 left-0 z-20 flex flex-col overflow-hidden rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-[var(--shadow-float)] ${
        place?.side === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
      }`}
    >
      <PlaylistTree
        tree={tree}
        options={options}
        tokens={tokens}
        onToggle={onToggle}
        onEscape={onClose}
      />
    </div>
  )
}

function TreeField({
  library,
  disabled,
  label,
  testId,
  tree,
  options,
  tokens,
  onToggle,
}: {
  library: PlaylistLibrary
  disabled?: PlaylistsDisabled
  label: string
  testId: string
  tree: readonly SourceNode[]
  options: readonly PlaylistOption[]
  tokens: readonly Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const buttonId = useId()
  const countId = useId()
  const whereId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const parts = whereParts(tree, tokens)
  const app = tr(`sources.${library}`)
  const Icon = LIBRARY_ICON[library]
  return (
    <div data-testid={fieldTestId(library, testId)} className="group block @[24rem]:contents">
      <label
        htmlFor={buttonId}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-dim @[24rem]:col-start-1 @[24rem]:mb-0 @[24rem]:min-h-[34px] @[24rem]:max-w-32 @[24rem]:flex-row-reverse @[24rem]:justify-start @[24rem]:text-right"
      >
        {label}
        <Icon size={12} />
      </label>
      <div ref={rootRef} className="relative min-w-0 @[24rem]:col-start-2">
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          data-testid="playlists-summary"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-describedby={tokens.length > 0 ? `${countId} ${whereId}` : countId}
          disabled={disabled !== undefined}
          onClick={() => setOpen((v) => !v)}
          className={`flex h-[34px] w-full items-center gap-2 rounded-lg border bg-[var(--color-panel-2)]/30 px-3 text-left text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
            open ? 'border-[var(--color-accent)]' : 'border-[var(--color-line-strong)]'
          }`}
        >
          {disabled ? (
            <span id={countId} className="min-w-0 flex-1 truncate text-fg-faint">
              {tr('editor.playlists.unconfirmed')}
            </span>
          ) : tokens.length > 0 ? (
            <>
              <span
                id={countId}
                data-testid="playlists-count"
                className="shrink-0 font-medium text-fg"
              >
                {tr('editor.playlists.count', { count: tokens.length })}
              </span>
              <span
                id={whereId}
                data-testid="playlists-where"
                className="min-w-0 flex-1 truncate text-xs text-fg-faint"
              >
                {parts.map((p, i) => (
                  <Fragment key={p.key}>
                    {i > 0 && ' · '}
                    {p.pending ? (
                      <span
                        data-testid={`playlists-pending-${p.text}`}
                        data-pending="true"
                        className="text-[var(--color-accent)]"
                      >
                        <Tooltip label={tr('editor.playlists.pending')} />
                        {p.text}
                      </span>
                    ) : (
                      p.text
                    )}
                  </Fragment>
                ))}
              </span>
            </>
          ) : (
            <span id={countId} className="min-w-0 flex-1 truncate text-fg-faint">
              {tr('editor.playlists.placeholder')}
            </span>
          )}
          <ChevronDown size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />
        </button>
        {open && (
          <TreePopover
            app={app}
            tree={tree}
            options={options}
            tokens={tokens}
            onToggle={onToggle}
            onClose={() => {
              setOpen(false)
              buttonRef.current?.focus()
            }}
          />
        )}
      </div>
    </div>
  )
}

export function PlaylistsField({
  library = 'rekordbox',
  disabled,
  label,
  tree,
  options,
  value,
  onChange,
}: {
  library?: PlaylistLibrary
  disabled?: PlaylistsDisabled
  label: string
  tree: SourceNode[]
  options: PlaylistOption[]
  value: RekordboxPlaylistTarget[]
  onChange: (next: RekordboxPlaylistTarget[]) => void
}): React.JSX.Element {
  return (
    <TreeField
      library={library}
      disabled={disabled}
      label={label}
      testId="playlists-field"
      tree={tree}
      options={options}
      tokens={value.map((target) => ({ target, state: 'all' }))}
      onToggle={(target, on) =>
        onChange(on ? [...value, target] : value.filter((t) => targetKey(t) !== targetKey(target)))
      }
    />
  )
}

export function PlaylistsBulkField({
  library = 'rekordbox',
  disabled,
  label,
  tree,
  options,
  states,
  onToggle,
}: {
  library?: PlaylistLibrary
  disabled?: PlaylistsDisabled
  label: string
  tree: SourceNode[]
  options: PlaylistOption[]
  states: Token[]
  onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
}): React.JSX.Element {
  return (
    <TreeField
      library={library}
      disabled={disabled}
      label={label}
      testId="playlists-bulk"
      tree={tree}
      options={options}
      tokens={states}
      onToggle={onToggle}
    />
  )
}
