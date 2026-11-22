import { Check, ChevronRight, CircleArrowUp, Loader2, TriangleAlert } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { PILL_TEXT } from './ListRow'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { AppleMusicIcon, EngineIcon } from './SourceIcons'
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

const LIBRARY_ICON = { appleMusic: AppleMusicIcon, engineDj: EngineIcon }

interface Props {
  open: boolean
  onToggle: () => void
  libraryName: string
  librarySource: keyof typeof LIBRARY_ICON
  verdict: LibraryVerdict | null
  // Why the winning copy won, said with the verdict: the table below shows only the figures.
  verdictDetail?: string
  copyFormat: string
  libraryBetter: boolean
  comparison?: React.ReactNode
  comparisonOpen: boolean
  onToggleComparison: () => void
}

export function LibrarySection({
  open,
  onToggle,
  libraryName,
  librarySource,
  verdict,
  verdictDetail,
  copyFormat,
  libraryBetter,
  comparison: given,
  comparisonOpen,
  onToggleComparison,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const comparisonId = useId()
  const glyph = verdict ? verdictGlyph[verdict] : null
  const verdictLabel = glyph
    ? verdictDetail
      ? `${tr(glyph.label)}. ${verdictDetail}`
      : tr(glyph.label)
    : ''
  // Same audio leaves nothing to weigh, so the row opens nothing.
  const comparison = verdict === 'same' ? undefined : given
  const LibraryIcon = LIBRARY_ICON[librarySource]
  const rowContent = (
    <>
      <span
        data-testid="library-row-icon"
        data-source={librarySource}
        role="img"
        aria-label={libraryName}
        className="flex shrink-0 text-fg-dim"
      >
        <LibraryIcon size={14} />
      </span>
      <span className="truncate text-fg">{libraryName}</span>
      <span className="flex h-1.5 w-1.5 shrink-0">
        {libraryBetter && (
          <span
            data-testid="library-row-better"
            role="img"
            aria-label={tr('editor.libraryRowBetter')}
            className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]"
          />
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {/* The track list's format chip, outlined rather than tinted: a tint there is the
            file's quality verdict, which this copy does not carry. */}
        {copyFormat && (
          <span
            data-testid="library-row-format"
            className={`flex h-4 items-center rounded px-[5px] text-fg-dim ring-1 ring-[var(--color-line-strong)] ring-inset ${PILL_TEXT}`}
          >
            {copyFormat}
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
  const rowClass = 'flex h-[30px] w-full items-center gap-2 pl-3 pr-3 text-left text-xs'
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
          {comparison ? (
            <button
              type="button"
              data-testid="library-row"
              aria-expanded={comparisonOpen}
              aria-controls={comparisonId}
              onClick={onToggleComparison}
              className={`press rounded-md hover:bg-[var(--color-hover)] ${rowClass}`}
            >
              {rowContent}
            </button>
          ) : (
            <div data-testid="library-row" className={rowClass}>
              {rowContent}
            </div>
          )}
          {comparison && comparisonOpen && <div id={comparisonId}>{comparison}</div>}
        </div>
      </SectionBody>
    </div>
  )
}
