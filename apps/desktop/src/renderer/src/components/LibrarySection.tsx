import { ChevronRight } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SectionPill } from './SectionPill'

export type LibraryVerdict = 'here' | 'library' | 'same' | 'measuring'

const verdictBadge: Record<LibraryVerdict, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  here: { tone: 'good', label: 'editor.libraryVerdictHere' },
  library: { tone: 'warn', label: 'editor.libraryVerdictLibrary' },
  same: { tone: 'neutral', label: 'editor.libraryVerdictSame' },
  measuring: { tone: 'neutral', label: 'editor.libraryVerdictMeasuring' },
}

export interface LibraryRow {
  id: string
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
  rows: LibraryRow[]
}

const rowClass = 'flex h-[30px] w-full items-center gap-2 pl-3 pr-3 text-left text-xs'

function LibraryRowItem({ row }: { row: LibraryRow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const comparisonId = useId()
  const { comparison, comparisonOpen } = row
  const rowContent = (
    <>
      <span className="flex h-1.5 w-1.5 shrink-0">
        {row.better && (
          <span
            data-testid="library-row-better"
            role="img"
            aria-label={tr('editor.libraryRowBetter')}
            className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]"
          />
        )}
      </span>
      <span className="truncate text-fg">{row.name}</span>
      <span className="ml-auto shrink-0 text-fg-dim tabular-nums">{row.format}</span>
      {comparison && (
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-fg-dim transition-transform ${comparisonOpen ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      )}
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

export function LibrarySection({ open, onToggle, verdict, rows }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const badge = verdict ? verdictBadge[verdict] : null
  return (
    <div data-testid="library-section" className="relative">
      <SectionHeader
        sectionId="library"
        title={tr('editor.librarySectionTitle')}
        open={open}
        onToggle={onToggle}
        status={
          badge && (
            <SectionPill tone={badge.tone} testid="library-verdict">
              {tr(badge.label)}
            </SectionPill>
          )
        }
      />
      <SectionBody open={open}>
        <div className="mt-2">
          {rows.map((row) => (
            <LibraryRowItem key={row.id} row={row} />
          ))}
        </div>
      </SectionBody>
    </div>
  )
}
