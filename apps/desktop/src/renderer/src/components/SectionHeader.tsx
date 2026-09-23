import { ChevronRight, Info, Maximize2, Minimize2 } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { type EditorSection, useMaximizedSection } from '../hooks/useEditorSections'
import { Tooltip } from './Tooltip'

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
  // One-line digest of the section's state, shown only while folded — open, the
  // controls below say the same thing. Stating even the idle state ("Off") keeps a
  // folded header unambiguous between "off" and "never looked".
  summary?: string
  // The digest's testid, named per section so tests never fish among siblings.
  summaryTestId?: string
  // True when the summary is an off/none state rather than a live figure. It steps the
  // text back a shade (fg-faint, not fg-dim) so a column of folded headers reads the
  // sections that carry real numbers first and the switched-off ones recede.
  summaryMuted?: boolean
  right?: React.ReactNode
  // What the section is for, in a sentence. It rides an ⓘ next to the title rather
  // than a paragraph under it: the explanation is read once and the two lines it
  // cost were charged on every visit, pushing the actual work down the panel.
  help?: string
  // Which section this header belongs to. Always set: the ⌘[ / ⌘] jumps find headers by
  // it. Whether the section earns a maximize toggle is a separate question — see
  // `maximizable`, which used to be conflated with this and started offering the button
  // on every section the moment the jumps needed the id everywhere.
  sectionId?: EditorSection
  // Present on the sections that earn a maximize toggle (the wave-work ones): the header
  // wires itself to the shared maximized-section store, so the Editor's overlay and every
  // header stay one state.
  maximizable?: boolean
  // The id of the SectionBody this header folds, so aria-controls can say which region
  // the expanded state belongs to.
  bodyId?: string
  // A short state that belongs to the whole section (the metadata's library membership),
  // set right after the title on the same line, open or folded. It is described to a screen
  // reader rather than folded into the button's name, which stays the title alone.
  status?: React.ReactNode
}

export function SectionHeader({
  title,
  open,
  onToggle,
  summary,
  summaryTestId,
  summaryMuted,
  right,
  help,
  sectionId,
  maximizable,
  bodyId,
  status,
}: SectionHeaderProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const statusId = useId()
  const { maximized, setMaximized } = useMaximizedSection()
  const isMaximized = sectionId !== undefined && maximized === sectionId
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      {/* The button stretches across the free width (and pads a few px vertically)
          so the whole header row folds the section, not just the title's letters;
          the right-slot actions stay outside it. aria-label pins the accessible
          name to the title alone — the summary is state, not name. The h3 puts each
          section in a screen reader's heading list; it takes the button's flex slot.
          The heading never narrows below its chevron and title: when the right-slot pills and
          buttons don't fit beside it, the row wraps them onto a line of their own instead of
          letting them paint over the title. The folded summary is zero-width at rest and only
          grows into free space, so a long digest truncates rather than forcing that wrap. */}
      <h3 className="flex min-w-min flex-1">
        <button
          type="button"
          // The section jumps (⌘[ / ⌘]) move focus header to header, so each one has to be
          // findable from outside React without a ref registry to keep in sync.
          data-section-header={sectionId}
          onClick={onToggle}
          aria-label={title}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-describedby={status ? statusId : undefined}
          className="-my-1.5 flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[13px] font-semibold text-fg-muted hover:text-fg"
        >
          <ChevronRight
            aria-hidden="true"
            className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="shrink-0">{title}</span>
          {status && (
            <span id={statusId} className="flex shrink-0 items-center gap-x-4 pl-2">
              {status}
            </span>
          )}
          {!open && summary && (
            <span
              data-testid={summaryTestId}
              className={`w-0 min-w-0 flex-1 truncate pl-3 text-right text-xs font-normal tabular-nums ${
                summaryMuted ? 'text-fg-faint' : 'text-fg-dim'
              }`}
            >
              {summary}
            </span>
          )}
        </button>
      </h3>
      {help && (
        <span
          data-testid="section-help"
          role="note"
          className="relative flex h-5 w-5 shrink-0 items-center justify-center text-fg-dim hover:text-fg-muted"
        >
          <Info className="h-3 w-3" aria-hidden="true" />
          {/* The sentence is the note's content for a screen reader, and the
              tooltip's label for a pointer — one source, both audiences. */}
          <span className="sr-only">{help}</span>
          <Tooltip label={help} />
        </span>
      )}
      {right}
      {maximizable === true && sectionId !== undefined && (
        <button
          type="button"
          data-testid="section-maximize"
          aria-label={isMaximized ? tr('editor.sectionRestore') : tr('editor.sectionMaximize')}
          aria-pressed={isMaximized}
          onClick={() => setMaximized(isMaximized ? null : sectionId)}
          className="press flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:text-fg"
        >
          {isMaximized ? (
            <Minimize2 className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  )
}
