import { Check } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS, OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type { FormatSetting, LibraryCopyAction, OutputFormat } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { SPLIT_ITEM, SPLIT_MENU } from './SplitButton'

export function FormatDestinationMenu({
  menuRef,
  onMenuKeyDown,
  offerSource,
  formats = true,
  outputFormat,
  exportedFormat,
  destination,
  destinations,
  onPickFormat,
  onPickDestination,
  clearAfter = false,
  onToggleClearAfter,
  className = SPLIT_MENU,
  libraryCopy,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>
  onMenuKeyDown: (e: React.KeyboardEvent) => void
  offerSource: boolean
  formats?: boolean
  outputFormat: FormatSetting
  exportedFormat: OutputFormat | null | undefined
  destination: Destination
  destinations: readonly Destination[]
  onPickFormat: (format: FormatSetting) => void
  onPickDestination: (destination: Destination) => void
  clearAfter?: boolean
  onToggleClearAfter?: () => void
  className?: string
  libraryCopy?: {
    heading: string
    action: LibraryCopyAction
    updatable: boolean
    onPick: (action: LibraryCopyAction) => void
  }
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const libraryHeadingId = useId()
  const formatHeadingId = useId()
  const destinationHeadingId = useId()
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={tr('editor.chooseFormat')}
      onKeyDown={onMenuKeyDown}
      className={className}
    >
      {/* First, since with a copy in the library the body's press acts on that copy: Update
          and Replace sound alike, so each says in grey what it does to it. */}
      {libraryCopy && (
        <fieldset aria-labelledby={libraryHeadingId} className="min-w-0">
          <p
            id={libraryHeadingId}
            data-testid="library-copy-heading"
            className="px-3 pt-1 pb-0.5 text-label font-medium text-fg-dim"
          >
            {libraryCopy.heading}
          </p>
          {(
            [
              ['update', 'editor.update', 'editor.libraryCopyKeepsAudio'],
              ['replace', 'editor.replaceAction', 'editor.libraryCopyWithThisFile'],
            ] as const
          ).map(([action, verb, note]) => (
            <button
              key={action}
              type="button"
              data-testid={`library-copy-${action}`}
              role="menuitemradio"
              aria-checked={action === libraryCopy.action}
              disabled={action === 'update' && !libraryCopy.updatable}
              onClick={() => libraryCopy.onPick(action)}
              className={`${SPLIT_ITEM} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                action === libraryCopy.action ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              <span className="flex flex-col">
                {tr(verb)}
                <span className="text-label font-normal text-fg-dim">{tr(note)}</span>
              </span>
            </button>
          ))}
        </fieldset>
      )}
      {formats && (
        <fieldset aria-labelledby={formatHeadingId} className="min-w-0">
          <p
            id={formatHeadingId}
            className={`px-3 pb-0.5 text-label font-medium text-fg-dim ${
              libraryCopy ? 'mt-1 border-t border-[var(--color-line)] pt-2' : 'pt-1'
            }`}
          >
            {tr('editor.menuFormat')}
          </p>
          {/* "Same as source" only means something over several files at once — a single
              track's own format IS its own format, so resolving it there is equivalent
              and more informative. Offered only when converting a selection. */}
          {(offerSource ? FORMAT_SETTINGS : OUTPUT_FORMATS).map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`process-format-${id}`}
              role="menuitemradio"
              aria-checked={id === outputFormat}
              onClick={() => onPickFormat(id)}
              className={`${SPLIT_ITEM} ${
                id === outputFormat ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              {tr(`settings.formats.${id}`)}
              {id === exportedFormat && (
                <Check className="h-3.5 w-3.5 text-good" strokeWidth={2.5} aria-hidden="true" />
              )}
            </button>
          ))}
        </fieldset>
      )}
      <fieldset aria-labelledby={destinationHeadingId} className="min-w-0">
        <p
          id={destinationHeadingId}
          className={`px-3 pb-0.5 text-label font-medium text-fg-dim ${
            formats ? 'mt-1 border-t border-[var(--color-line)] pt-2' : 'pt-1'
          }`}
        >
          {tr('editor.menuDestination')}
        </p>
        {destinations.map((d) => (
          <button
            key={d}
            type="button"
            data-testid={`process-destination-${d}`}
            role="menuitemradio"
            aria-checked={d === destination}
            // Music can't ingest FLAC — the same pin the Settings radio applies.
            disabled={d === 'appleMusic' && outputFormat === 'flac'}
            onClick={() => onPickDestination(d)}
            className={`${SPLIT_ITEM} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
              d === destination ? 'font-medium text-[var(--color-accent)]' : ''
            }`}
          >
            {d === 'overwrite' ? (
              <span className="flex flex-col">
                {tr(`settings.destinations.${d}`)}
                <span className="text-label font-normal text-warn">
                  {tr('editor.menuOverwriteNote')}
                </span>
              </span>
            ) : (
              tr(`settings.destinations.${d}`)
            )}
          </button>
        ))}
      </fieldset>
      {/* Last and set apart: it is no choice of format or place but what happens to the
          list once the batch ends, and it stays open so the mark shows what was switched. */}
      {onToggleClearAfter && (
        <div className="mt-1 border-t border-[var(--color-line)] pt-1">
          <button
            type="button"
            data-testid="process-clear-after"
            role="menuitemcheckbox"
            aria-checked={clearAfter}
            onClick={onToggleClearAfter}
            className={SPLIT_ITEM}
          >
            {tr('settings.clearListAfterConvert')}
            <Check
              className={`h-3.5 w-3.5 shrink-0 text-[var(--color-accent)] ${clearAfter ? '' : 'invisible'}`}
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </div>
  )
}
