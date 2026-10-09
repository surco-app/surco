import { Copy, FilePlus, ListMusic, type LucideIcon, SpellCheck } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onAdd: () => void
  addShortcut: string
  // Undefined off macOS: both read Apple Music, so the rows would open onto nothing.
  onImportPlaylist?: () => void
  onReviewMusic?: () => void
  onShowDuplicates?: () => void
}

// The empty screen's ways in, laid out like the ⌘K palette's rows so the first screen
// already speaks the app's command vocabulary. The icon tile is ConvertFooter's, which is
// why the row lights with the hover token rather than the palette's accent-soft: on that
// background the tile would vanish.
export function EmptyActions({
  onAdd,
  addShortcut,
  onImportPlaylist,
  onReviewMusic,
  onShowDuplicates,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="empty-actions"
      className="w-full rounded-2xl border border-[var(--color-line-strong)] p-2 text-left"
    >
      <Group testid="empty-group-bring" label={t('empty.bringGroup')}>
        <Action
          testid="add-files"
          Icon={FilePlus}
          title={t('empty.addTracks')}
          hint={t('empty.addTracksHint')}
          shortcut={addShortcut}
          onClick={onAdd}
        />
        {onImportPlaylist && (
          <Action
            testid="empty-import-playlist"
            Icon={ListMusic}
            title={t('empty.importApplePlaylist')}
            hint={t('empty.importHint')}
            onClick={onImportPlaylist}
          />
        )}
      </Group>
      {onReviewMusic && onShowDuplicates && (
        <>
          <div aria-hidden="true" className="mx-3 my-1.5 h-px bg-[var(--color-line)]" />
          <Group testid="empty-group-library" label={t('empty.libraryGroup')}>
            <Action
              testid="empty-music-review"
              Icon={SpellCheck}
              title={t('empty.reviewMusic')}
              hint={t('empty.reviewMusicHint')}
              onClick={onReviewMusic}
            />
            <Action
              testid="empty-music-duplicates"
              Icon={Copy}
              title={t('empty.showDuplicates')}
              hint={t('empty.duplicatesHint')}
              onClick={onShowDuplicates}
            />
          </Group>
        </>
      )}
    </div>
  )
}

function Group({
  testid,
  label,
  children,
}: {
  testid: string
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; these are command buttons
    <div role="group" aria-labelledby={id} data-testid={testid}>
      <p
        id={id}
        className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-fg-dim uppercase"
      >
        {label}
      </p>
      {children}
    </div>
  )
}

function Action({
  testid,
  Icon,
  title,
  hint,
  shortcut,
  onClick,
}: {
  testid: string
  Icon: LucideIcon
  title: string
  hint: string
  shortcut?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)] focus-visible:bg-[var(--color-hover)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-fg">{title}</span>
        <span className="truncate text-xs text-fg-faint">{hint}</span>
      </span>
      {shortcut && (
        <span data-testid="empty-action-shortcut" className="ml-4 shrink-0 text-xs text-fg-dim">
          {shortcut}
        </span>
      )}
    </button>
  )
}
