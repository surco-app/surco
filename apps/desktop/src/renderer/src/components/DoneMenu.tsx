import { Check, Disc3, Ellipsis, FolderOpen, RotateCw } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FORMAT_SETTINGS } from '../../../shared/outputFormats'
import type { FormatSetting, OutputFormat } from '../../../shared/types'
import type { Destination } from '../lib/destination'
import { exportButtonLabel } from '../lib/exportLabel'
import { FORMATS } from './ExportButton'
import { SPLIT_ITEM, SPLIT_MENU, useSplitMenu } from './SplitButton'
import { Tooltip } from './Tooltip'

interface DoneMenuProps {
  multi: boolean
  outputFormat: FormatSetting
  exportedFormat: OutputFormat | null
  incomplete: boolean
  incompleteReason?: string
  destination: Destination
  destinations: readonly Destination[]
  revealPath?: string | null
  onProcess: (format: FormatSetting) => void
  onSelectFormat: (format: FormatSetting) => void
  onSelectDestination: (destination: Destination) => void
  onExportCollection: () => void
}

const ITEM_ICON = 'h-3.5 w-3.5 shrink-0 text-fg-dim'

// The converted footer's "•••": every follow-up named in full, the way macOS menus do,
// so the row itself spends one icon on all of them whatever the language. Picking a
// format or destination keeps it open, since the only thing a pick changes is the
// "Convert again" label at the top of this same menu.
export function DoneMenu({
  multi,
  outputFormat,
  exportedFormat,
  incomplete,
  incompleteReason,
  destination,
  destinations,
  revealPath,
  onProcess,
  onSelectFormat,
  onSelectDestination,
  onExportCollection,
}: DoneMenuProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  const formatHeadingId = useId()
  const destinationHeadingId = useId()
  const reasonId = useId()
  const formatLabel =
    outputFormat === 'source' ? tr('settings.formats.source') : outputFormat.toUpperCase()
  const again = exportButtonLabel({
    processing: false,
    quiet: true,
    inPlace: false,
    stale: false,
    done: false,
    withAppleMusic: false,
    djTargets: [],
    format: formatLabel,
    exportedFormat: multi ? null : (exportedFormat?.toUpperCase() ?? null),
  })

  function run(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        data-testid="done-more"
        ref={toggleRef}
        aria-label={tr('editor.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press relative flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-line-strong)] aria-expanded:bg-[var(--color-accent-soft)] aria-expanded:text-[var(--color-accent)]"
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
        <Tooltip label={tr('editor.moreActions')} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('editor.moreActions')}
          onKeyDown={onMenuKeyDown}
          className={`${SPLIT_MENU} w-64`}
        >
          <button
            type="button"
            data-testid="process-btn"
            role="menuitem"
            aria-disabled={incomplete || undefined}
            aria-describedby={incomplete && incompleteReason ? reasonId : undefined}
            onClick={incomplete ? undefined : () => run(() => onProcess(outputFormat))}
            className={`${SPLIT_ITEM} justify-start gap-2 font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
          >
            <RotateCw className={ITEM_ICON} aria-hidden="true" />
            {tr(again.key, again.options)}
          </button>
          {incomplete && incompleteReason && (
            <span id={reasonId} className="sr-only">
              {incompleteReason}
            </span>
          )}
          <fieldset aria-labelledby={formatHeadingId} className="min-w-0">
            <p
              id={formatHeadingId}
              className="mt-1 border-t border-[var(--color-line)] px-3 pt-2 pb-0.5 text-[11px] font-medium text-fg-dim"
            >
              {tr('editor.menuFormat')}
            </p>
            {(multi ? FORMAT_SETTINGS : FORMATS).map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`process-format-${id}`}
                role="menuitemradio"
                aria-checked={id === outputFormat}
                onClick={() => onSelectFormat(id)}
                className={`${SPLIT_ITEM} ${id === outputFormat ? 'font-medium text-[var(--color-accent)]' : ''}`}
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
                disabled={d === 'appleMusic' && outputFormat === 'flac'}
                onClick={() => onSelectDestination(d)}
                className={`${SPLIT_ITEM} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
                  d === destination ? 'font-medium text-[var(--color-accent)]' : ''
                }`}
              >
                {tr(`settings.destinations.${d}`)}
              </button>
            ))}
          </fieldset>
          <div className="mt-1 border-t border-[var(--color-line)] pt-1">
            <button
              type="button"
              data-testid="export-collection"
              role="menuitem"
              onClick={() => run(onExportCollection)}
              className={`${SPLIT_ITEM} justify-start gap-2`}
            >
              <Disc3 className={ITEM_ICON} aria-hidden="true" />
              {tr('editor.exportCollection')}
            </button>
            {revealPath && (
              <button
                type="button"
                data-testid="show-file"
                role="menuitem"
                onClick={() => run(() => window.api.reveal(revealPath))}
                className={`${SPLIT_ITEM} justify-start gap-2`}
              >
                <FolderOpen className={ITEM_ICON} aria-hidden="true" />
                {tr('editor.showFile')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
