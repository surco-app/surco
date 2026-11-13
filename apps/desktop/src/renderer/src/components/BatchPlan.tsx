import { ChevronDown } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { FormatSetting } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { FormatDestinationMenu } from './FormatDestinationMenu'
import { useSplitMenu } from './SplitButton'

export function BatchPlan({
  count,
  format,
  destination,
  destinations,
  leftOut,
  onBlockedPress,
  onSelectFormat,
  onSelectDestination,
}: {
  count: number
  format: FormatSetting
  destination: Destination
  destinations: readonly Destination[]
  leftOut?: string
  onBlockedPress?: () => void
  onSelectFormat: (format: FormatSetting) => void
  onSelectDestination: (destination: Destination) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  const formatLabel = format === 'source' ? tr('settings.formats.source') : format.toUpperCase()
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {leftOut && (
        <button
          type="button"
          data-testid="batch-plan-blocked"
          onClick={onBlockedPress}
          className="press mr-auto flex items-center gap-1.5 text-xs text-fg-dim hover:text-fg"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />
          {leftOut}
        </button>
      )}
      <span data-testid="batch-plan" className="text-xs text-fg-dim">
        {tr('editor.batchPlan', {
          count,
          format: formatLabel,
          destination: tr(`settings.destinations.${destination}`),
        })}
      </span>
      <div ref={ref} className="relative">
        <button
          type="button"
          data-testid="process-format-toggle"
          ref={toggleRef}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="press flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
        >
          {tr('editor.formatAndDestination')}
          <ChevronDown
            aria-hidden="true"
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && (
          <FormatDestinationMenu
            menuRef={menuRef}
            onMenuKeyDown={onMenuKeyDown}
            offerSource
            outputFormat={format}
            exportedFormat={null}
            destination={destination}
            destinations={destinations}
            onPickFormat={(f) => {
              setOpen(false)
              onSelectFormat(f)
            }}
            onPickDestination={(d) => {
              setOpen(false)
              onSelectDestination(d)
            }}
          />
        )}
      </div>
    </div>
  )
}
