import { Check, ChevronRight, CircleArrowUp, Loader2, TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'
import { PILL_TEXT } from './ListRow'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SOURCE_ICON } from './SourceRail'
import { Tooltip } from './Tooltip'

export type LibraryVerdict = 'here' | 'library' | 'same' | 'measuring'

// The verdict as a glyph beside the title, its words kept for the tooltip and a screen
// reader. The amber warning is a triangle and both greens keep shapes of their own, so no
// state rests on colour alone; the four share one box so the title never shifts.
const verdictGlyph: Record<
  LibraryVerdict,
  { tone: 'good' | 'warn' | 'neutral'; label: string; Icon: typeof Check; className: string }
> = {
  here: {
    tone: 'good',
    label: 'editor.libraryVerdictHere',
    Icon: CircleArrowUp,
    className: 'text-[var(--color-good)]',
  },
  library: {
    tone: 'warn',
    label: 'editor.libraryVerdictLibrary',
    Icon: TriangleAlert,
    className: 'text-[var(--color-warn)]',
  },
  same: {
    tone: 'good',
    label: 'editor.libraryVerdictSame',
    Icon: Check,
    className: 'text-[var(--color-good)]',
  },
  measuring: {
    tone: 'neutral',
    label: 'editor.libraryVerdictMeasuring',
    Icon: Loader2,
    className: 'animate-spin text-fg-faint motion-reduce:animate-none',
  },
}

export interface LibraryRow {
  id: PlaylistSource
  name: string
  format: string
  better: boolean
  comparison?: React.ReactNode
  comparisonOpen: boolean
  onToggleComparison: () => void
}

interface Props {
  open: boolean
  onToggle: () => void
  verdict: LibraryVerdict | null
  // Why the winning copy won, said with the verdict: the table below shows only the figures.
  verdictDetail?: string
  rows: LibraryRow[]
}

const rowClass = 'flex h-[30px] w-full items-center gap-2 pl-3 pr-3 text-left text-xs'

function LibraryRowItem({ row, marked }: { row: LibraryRow; marked: boolean }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const comparisonId = useId()
  const { comparison, comparisonOpen } = row
  const LibraryIcon = SOURCE_ICON[row.id]
  const rowContent = (
    <>
      <span
        data-testid="library-row-icon"
        data-source={row.id}
        role="img"
        aria-label={row.name}
        className="flex shrink-0 text-fg-dim"
      >
        <LibraryIcon size={14} />
      </span>
      <span className="truncate text-fg">{row.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {marked && (
          <span
            data-testid="library-row-better"
            role="img"
            aria-label={tr('editor.libraryRowBetter')}
            className="relative flex h-3 w-3 shrink-0"
          >
            <TriangleAlert className="h-3 w-3 text-[var(--color-warn)]" aria-hidden="true" />
            <Tooltip label={tr('editor.libraryRowBetter')} />
          </span>
        )}
        {/* The track list's format chip, outlined rather than tinted: a tint there is the
            file's quality verdict, which this copy does not carry. */}
        {row.format && (
          <span
            data-testid="library-row-format"
            className={`flex h-4 items-center rounded px-[5px] text-fg-dim ring-1 ring-[var(--color-line-strong)] ring-inset ${PILL_TEXT}`}
          >
            {row.format}
          </span>
        )}
        {comparison && (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-fg-dim transition-transform ${comparisonOpen ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        )}
      </span>
    </>
  )
  return (
    <>
      {comparison ? (
        <button
          type="button"
          data-testid="library-row"
          data-row={row.id}
          aria-expanded={comparisonOpen}
          aria-controls={comparisonId}
          onClick={row.onToggleComparison}
          className={`press rounded-md hover:bg-[var(--color-hover)] ${rowClass}`}
        >
          {rowContent}
        </button>
      ) : (
        <div data-testid="library-row" data-row={row.id} className={rowClass}>
          {rowContent}
        </div>
      )}
      {comparison && comparisonOpen && <div id={comparisonId}>{comparison}</div>}
    </>
  )
}

export function LibrarySection({
  open,
  onToggle,
  verdict,
  verdictDetail,
  rows,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const glyph = verdict ? verdictGlyph[verdict] : null
  // With one row the header's triangle already points at it; with several, each row holding a
  // better copy carries a small one of its own to say which program has it.
  const marksRows = rows.length > 1
  const verdictLabel = glyph
    ? verdictDetail
      ? tr('editor.libraryVerdictWithReason', { verdict: tr(glyph.label), reason: verdictDetail })
      : tr(glyph.label)
    : ''
  return (
    <div data-testid="library-section" className="relative">
      <SectionHeader
        sectionId="library"
        title={tr('editor.librarySectionTitle')}
        open={open}
        onToggle={onToggle}
        status={
          glyph && (
            <span
              data-testid="library-verdict"
              data-tone={glyph.tone}
              role="img"
              aria-label={verdictLabel}
              className="relative flex h-3.5 w-3.5 shrink-0"
            >
              <glyph.Icon className={`h-3.5 w-3.5 ${glyph.className}`} aria-hidden="true" />
              <Tooltip label={verdictLabel} />
            </span>
          )
        }
      />
      <SectionBody open={open}>
        <div className="mt-2">
          {rows.map((row) => (
            <LibraryRowItem key={row.id} row={row} marked={marksRows && row.better} />
          ))}
        </div>
      </SectionBody>
    </div>
  )
}
