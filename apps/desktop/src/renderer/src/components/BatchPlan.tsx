import { ChevronDown } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS } from '../../../shared/outputFormats'
import type { FormatSetting } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { FormatDestinationMenu } from './FormatDestinationMenu'
import { useSplitMenu } from './SplitButton'
import { Tooltip } from './Tooltip'

export function BatchPlan({
  count,
  total,
  format,
  destination,
  destinations,
  leftOut,
  onBlockedPress,
  onSelectFormat,
  onSelectDestination,
  onConvert,
  convertHint,
  tagsOnly = false,
}: {
  count: number
  total: number
  format: FormatSetting
  destination: Destination
  destinations: readonly Destination[]
  leftOut?: string
  onBlockedPress?: () => void
  onSelectFormat: (format: FormatSetting) => void
  onSelectDestination: (destination: Destination) => void
  onConvert?: () => void
  convertHint?: string
  tagsOnly?: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  const convertLabel =
    count < total
      ? tr(tagsOnly ? 'header.updateSomeSelected' : 'header.convertSomeSelected', {
          ready: count,
          total,
        })
      : tr(tagsOnly ? 'header.updateSelected' : 'header.convertSelected', { count })
  return (
    <div className="space-y-2">
      {leftOut && (
        <button
          type="button"
          data-testid="batch-plan-blocked"
          onClick={onBlockedPress}
          className="press flex w-full items-center gap-1.5 text-left text-xs text-fg-dim hover:text-fg"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
          {leftOut}
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* biome-ignore lint/a11y/useSemanticElements: an inline pill row; the group role names it without a fieldset's own layout, as SegmentedControl does */}
        <div
          role="group"
          aria-label={tr('editor.menuFormat')}
          className="flex max-w-full shrink-0 flex-wrap rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-field)] p-0.5"
        >
          {FORMAT_SETTINGS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`process-format-${id}`}
              aria-pressed={id === format}
              onClick={() => onSelectFormat(id)}
              className={`press group relative rounded-md px-2 py-0.5 text-label ${
                id === format
                  ? 'bg-[var(--color-accent-soft)] text-fg'
                  : 'text-fg-dim hover:text-fg'
              }`}
            >
              {id === 'source' ? tr('editor.formatSourceShort') : tr(`settings.formats.${id}`)}
              {id === 'source' && <Tooltip label={tr('settings.formats.source')} />}
            </button>
          ))}
        </div>
        <div ref={ref} className="relative flex min-w-0 flex-1 basis-16 justify-end">
          <button
            type="button"
            data-testid="batch-destination-toggle"
            ref={toggleRef}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="press group relative flex h-8 max-w-full items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
          >
            <span className="min-w-0 truncate">{tr(`settings.destinations.${destination}`)}</span>
            <Tooltip label={tr(`settings.destinations.${destination}`)} />
            <ChevronDown
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
          {open && (
            <FormatDestinationMenu
              menuRef={menuRef}
              onMenuKeyDown={onMenuKeyDown}
              offerSource
              formats={false}
              outputFormat={format}
              exportedFormat={null}
              destination={destination}
              destinations={destinations}
              onPickFormat={onSelectFormat}
              onPickDestination={(d) => {
                setOpen(false)
                onSelectDestination(d)
              }}
            />
          )}
        </div>
      </div>
      <button
        type="button"
        data-testid="batch-convert"
        onClick={onConvert}
        disabled={count === 0}
        className="press group relative w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40"
      >
        {convertLabel}
        <Tooltip label={convertLabel} hint={convertHint} />
      </button>
    </div>
  )
}
