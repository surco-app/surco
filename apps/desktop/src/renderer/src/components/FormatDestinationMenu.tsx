import { Check } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS, OUTPUT_FORMATS } from '../../../shared/outputFormats'
import type { FormatSetting, OutputFormat } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { SPLIT_ITEM, SPLIT_MENU } from './SplitButton'

export function FormatDestinationMenu({
  menuRef,
  onMenuKeyDown,
  offerSource,
  outputFormat,
  exportedFormat,
  destination,
  destinations,
  onPickFormat,
  onPickDestination,
  className = SPLIT_MENU,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>
  onMenuKeyDown: (e: React.KeyboardEvent) => void
  offerSource: boolean
  outputFormat: FormatSetting
  exportedFormat: OutputFormat | null | undefined
  destination: Destination
  destinations: readonly Destination[]
  onPickFormat: (format: FormatSetting) => void
  onPickDestination: (destination: Destination) => void
  className?: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
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
      <fieldset aria-labelledby={formatHeadingId} className="min-w-0">
        <p id={formatHeadingId} className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-fg-dim">
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
      <fieldset aria-labelledby={destinationHeadingId} className="min-w-0">
        <p
          id={destinationHeadingId}
          className="mt-1 border-t border-[var(--color-line)] px-3 pt-2 pb-0.5 text-[11px] font-medium text-fg-dim"
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
            className={`${SPLIT_ITEM} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
              d === destination ? 'font-medium text-[var(--color-accent)]' : ''
            }`}
          >
            {d === 'overwrite' ? (
              <span className="flex flex-col">
                {tr(`settings.destinations.${d}`)}
                <span className="text-[11px] font-normal text-warn">
                  {tr('editor.menuOverwriteNote')}
                </span>
              </span>
            ) : (
              tr(`settings.destinations.${d}`)
            )}
          </button>
        ))}
      </fieldset>
    </div>
  )
}
