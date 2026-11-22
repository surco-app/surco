import type { TFunction } from 'i18next'
import { ChevronRight, Loader2 } from 'lucide-react'
import type React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaylistSource } from '../../../shared/types'
import { formatTime } from '../lib/duration'
import { aggregateLibraryVerdict } from '../lib/libraryVerdict'
import { PILL_TEXT, PILL_TONE } from './ListRow'
import { SectionBody } from './SectionBody'
import { SectionHeader } from './SectionHeader'
import { SOURCE_ICON } from './SourceRail'
import { Tooltip } from './Tooltip'

export type LibraryVerdict =
  | 'here'
  | 'library'
  | 'same'
  | 'measuring'
  | 'different'
  | 'tie'
  | 'thisFile'

// Each copy's relation to this file in a short word: a glyph alone did not read as "the same
// copy". The amber is never carried by colour alone, the word says it too.
const STATE: Record<LibraryVerdict, { label: string; className: string }> = {
  same: { label: 'editor.libraryStateSame', className: 'bg-fg-faint/10 text-fg-faint' },
  here: { label: 'editor.libraryStateHere', className: PILL_TONE.good },
  library: { label: 'editor.libraryStateLibrary', className: PILL_TONE.warn },
  different: { label: 'editor.libraryStateDifferentBare', className: 'bg-fg-faint/15 text-fg-dim' },
  tie: { label: 'editor.libraryStateTie', className: 'bg-fg-faint/15 text-fg-dim' },
  thisFile: { label: 'editor.libraryStateThisFile', className: 'bg-fg-faint/10 text-fg-faint' },
  measuring: {
    label: 'editor.libraryStateMeasuring',
    className: 'border border-dashed border-[var(--color-line-strong)] text-fg-faint',
  },
}

export interface LibraryRow {
  id: PlaylistSource
  name: string
  format: string
  verdict: LibraryVerdict | null
  // Whether this copy will be compared at all: its state's place is kept from the start.
  comparable: boolean
  // The library copy's length, which tells another version apart at a glance.
  durationSec?: number
  // Why the winning copy won, said with the state: the table below shows only the figures.
  detail?: string
  comparison?: React.ReactNode
  comparisonOpen: boolean
  onToggleComparison: () => void
}

interface Props {
  open: boolean
  onToggle: () => void
  rows: LibraryRow[]
}

function StatePill({
  testid,
  verdict,
  words,
  detail,
}: {
  testid: string
  verdict: LibraryVerdict
  words: string
  detail?: string
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const label = detail
    ? tr('editor.libraryVerdictWithReason', { verdict: words, reason: detail })
    : words
  return (
    <span
      data-testid={testid}
      data-state={verdict}
      role="img"
      aria-label={label}
      className={`relative col-start-1 row-start-1 flex h-4 items-center gap-1 whitespace-nowrap rounded px-[5px] ${PILL_TEXT} ${STATE[verdict].className}`}
    >
      {verdict === 'measuring' && (
        <Loader2
          className="h-2.5 w-2.5 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {words}
      {detail && <Tooltip label={label} />}
    </span>
  )
}

const RESERVED_STATES = [
  'measuring',
  'same',
  'here',
  'library',
  'tie',
  'different',
  'thisFile',
] as const

function rowWords(row: LibraryRow, verdict: LibraryVerdict, tr: TFunction): string {
  if (verdict === 'different' && row.durationSec != null) {
    return tr('editor.libraryStateDifferent', { duration: formatTime(row.durationSec) })
  }
  return tr(STATE[verdict].label)
}

// Too narrow for the name, the format and the state on one line, the state drops under the
// name; the break is set by the panel's width, never by the state, so a row keeps its shape
// while the measurement lands.
const rowClass =
  'flex min-h-[30px] w-full flex-wrap items-center gap-x-2 gap-y-1 pl-3 pr-3 text-left text-xs @max-[22rem]:py-[7px]'

function LibraryRowItem({
  row,
  showState,
}: {
  row: LibraryRow
  showState: boolean
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const comparisonId = useId()
  const { verdict, comparison, comparisonOpen } = row
  const LibraryIcon = SOURCE_ICON[row.id]
  // Every state the row can take, unseen in one cell: the slot is as wide as the widest in
  // this language, with room for any length, so the row never shifts and the chips line up.
  const reserved = RESERVED_STATES.map((key) => ({
    key,
    words:
      key === 'different'
        ? tr('editor.libraryStateDifferent', { duration: '0:00:00' })
        : tr(STATE[key].label),
  }))
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
      <span className="min-w-0 flex-1 truncate text-fg">{row.name}</span>
      {/* The track list's format chip, outlined rather than tinted: a tint there is the
            file's quality verdict, which this copy does not carry. */}
      {row.format && (
        <span
          data-testid="library-row-format"
          className={`flex h-4 shrink-0 items-center rounded px-[5px] text-fg-dim ring-1 ring-[var(--color-line-strong)] ring-inset ${PILL_TEXT}`}
        >
          {row.format}
        </span>
      )}
      {showState && (verdict || row.comparable) && (
        <span
          data-testid="library-row-state-slot"
          className="grid shrink-0 justify-items-end @max-[22rem]:order-last @max-[22rem]:basis-full @max-[22rem]:justify-items-start @max-[22rem]:pl-[22px]"
        >
          {reserved.map(({ key, words }) => (
            <span
              key={key}
              data-testid="library-row-state-sizer"
              aria-hidden="true"
              className={`invisible col-start-1 row-start-1 flex h-4 items-center gap-1 whitespace-nowrap rounded px-[5px] ${PILL_TEXT} ${key === 'measuring' ? 'border' : ''}`}
            >
              {key === 'measuring' && (
                <Loader2 className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              )}
              {words}
            </span>
          ))}
          {verdict && (
            <StatePill
              testid="library-row-state"
              verdict={verdict}
              words={rowWords(row, verdict, tr)}
              detail={row.detail}
            />
          )}
        </span>
      )}
      {(comparison || verdict || row.comparable) && (
        <span data-testid="library-row-chevron-slot" className="flex h-3 w-3 shrink-0">
          {comparison && (
            <ChevronRight
              className={`h-3 w-3 text-fg-dim transition-transform ${comparisonOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          )}
        </span>
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

// The state every copy shares, with the length when it is another version of one length; none
// while any copy is still being measured, so the header does not settle and then jump.
function sharedState(rows: LibraryRow[]): LibraryRow | null {
  const [first] = rows.filter((row) => row.verdict || row.comparable)
  if (!first?.verdict || first.verdict === 'measuring' || first.verdict === 'thisFile') return null
  const same = rows.every(
    (row) =>
      !(row.verdict || row.comparable) ||
      (row.verdict === first.verdict &&
        (first.verdict !== 'different' || row.durationSec === first.durationSec)),
  )
  return same ? first : null
}

export function LibrarySection({ open, onToggle, rows }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const shared = sharedState(rows)
  const verdict = shared?.verdict ?? aggregateLibraryVerdict(rows.map((row) => row.verdict))
  const leading = shared ?? rows.find((row) => row.verdict === verdict)
  // A state every copy shares is said once, here, open or folded. Otherwise each row says its
  // own and, folded, the header says the state that most needs the reader.
  const headerWords = shared
    ? rowWords(shared, shared.verdict as LibraryVerdict, tr)
    : verdict === 'library' && leading
      ? tr('editor.libraryStateLibraryIn', { program: leading.name })
      : verdict
        ? tr(STATE[verdict].label)
        : ''
  return (
    <div data-testid="library-section" className="relative">
      <SectionHeader
        sectionId="library"
        title={tr('editor.librarySectionTitle')}
        open={open}
        onToggle={onToggle}
        status={
          (shared || !open) &&
          verdict && (
            <span className="grid">
              <StatePill
                testid="library-verdict"
                verdict={verdict}
                words={headerWords}
                detail={leading?.detail}
              />
            </span>
          )
        }
      />
      <SectionBody open={open}>
        <div className="mt-2 @container">
          {rows.map((row) => (
            <LibraryRowItem key={row.id} row={row} showState={!shared} />
          ))}
        </div>
      </SectionBody>
    </div>
  )
}
