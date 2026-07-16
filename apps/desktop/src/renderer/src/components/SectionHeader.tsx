import { ChevronRight, Info, Maximize2, Minimize2 } from 'lucide-react'
import type React from 'react'
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
  // Present on the sections that earn a maximize toggle (the wave-work ones):
  // the header wires itself to the shared maximized-section store, so the
  // Editor's overlay and every header stay one state.
  sectionId?: EditorSection
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
}: SectionHeaderProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { maximized, setMaximized } = useMaximizedSection()
  const isMaximized = sectionId !== undefined && maximized === sectionId
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The button stretches across the free width (and pads a few px vertically)
          so the whole header row folds the section, not just the title's letters;
          the right-slot actions stay outside it. aria-label pins the accessible
          name to the title alone — the summary is state, not name. */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={title}
        aria-expanded={open}
        className="-my-1.5 flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="shrink-0">{title}</span>
        {!open && summary && (
          <span
            data-testid={summaryTestId}
            className={`ml-auto min-w-0 truncate pl-3 font-normal tracking-normal normal-case tabular-nums ${
              summaryMuted ? 'text-fg-faint' : ''
            }`}
          >
            {summary}
          </span>
        )}
      </button>
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
      {sectionId !== undefined && (
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
