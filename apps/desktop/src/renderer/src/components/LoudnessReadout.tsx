import { Info } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { LoudnessResult } from '../../../shared/types'
import {
  formatDb,
  formatPercent,
  type Grade,
  gradeBalance,
  gradeCrest,
  gradeDcOffset,
  gradeLra,
  gradeLufs,
  gradeNoiseFloor,
  gradeTruePeak,
} from '../lib/quality'
import { SectionSubhead } from './SectionSubhead'
import { Tooltip } from './Tooltip'

// Per-grade colour for the analysis rows, reusing the good/warn/danger tokens
// (Tokyo Night). The dot is a solid status light; the value text carries the same
// colour so the verdict reads at a glance.
const GRADE_DOT: Record<Grade, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-danger',
}
const GRADE_TEXT: Record<Grade, string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-danger',
}

interface Props {
  loudness: LoudnessResult
  onShowHelp: () => void
}

// The EBU R128 figures as a colour-graded table. The astats-derived checks each appear
// only when measured (null = mono, a dead channel, or an unparseable reading), so an
// immeasurable row drops out rather than showing "−∞ dB" / "NaN%".
export function LoudnessReadout({ loudness: loud, onShowHelp }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const cell = (id: string, label: string, value: string, grade: Grade, hint: string) => ({
    id,
    label,
    value,
    grade,
    hint,
  })
  // One flat list — Loudness and Signal used to be separate labelled groups stacked in two
  // grids; merged, they fill one two-column table, each row dropping out when its figure is
  // immeasurable (null).
  const cells = [
    cell(
      'lufs',
      tr('editor.loudnessLufsLabel'),
      `${formatDb(loud.integratedLufs)} LUFS`,
      gradeLufs(loud.integratedLufs),
      tr('editor.loudnessLufsHint'),
    ),
    cell(
      'peak',
      tr('editor.loudnessPeakLabel'),
      `${formatDb(loud.truePeakDb)} dBTP`,
      gradeTruePeak(loud.truePeakDb),
      tr('editor.loudnessPeakHint'),
    ),
    cell(
      'range',
      tr('editor.loudnessRangeLabel'),
      `${formatDb(loud.lra)} LU`,
      gradeLra(loud.lra),
      tr('editor.loudnessRangeHint'),
    ),
    loud.crestDb !== null &&
      cell(
        'crest',
        tr('editor.loudnessCrestLabel'),
        `${formatDb(loud.crestDb)} dB`,
        gradeCrest(loud.crestDb),
        tr('editor.loudnessCrestHint'),
      ),
    loud.channelBalanceDb !== null &&
      cell(
        'balance',
        tr('editor.loudnessBalanceLabel'),
        `${formatDb(loud.channelBalanceDb)} dB`,
        gradeBalance(loud.channelBalanceDb),
        tr('editor.loudnessBalanceHint'),
      ),
    loud.dcOffset !== null &&
      cell(
        'dc',
        tr('editor.loudnessDcLabel'),
        formatPercent(loud.dcOffset),
        gradeDcOffset(loud.dcOffset),
        tr('editor.loudnessDcHint'),
      ),
    loud.noiseFloorDb !== null &&
      cell(
        'noise',
        tr('editor.loudnessNoiseLabel'),
        `${formatDb(loud.noiseFloorDb)} dB`,
        gradeNoiseFloor(loud.noiseFloorDb),
        tr('editor.loudnessNoiseHint'),
      ),
  ].filter((c) => c !== false)
  return (
    <div data-testid="loudness-readout" className="mt-3">
      {/* The lone help affordance now that the group headings are gone: a compact info
          button above the flat pill row, explaining the figures beneath it. */}
      <div className="mb-1.5 flex items-center gap-1">
        <SectionSubhead>{tr('editor.loudnessGroupLoudness')}</SectionSubhead>
        <button
          type="button"
          data-testid="loudness-help-toggle"
          aria-label={tr('editor.loudnessHelpTitle')}
          onClick={onShowHelp}
          className="press group relative flex h-5 w-5 items-center justify-center rounded-full text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          <Tooltip label={tr('editor.loudnessHelpTitle')} align="start" />
        </button>
      </div>
      {/* Same table as PropertiesReadout — two label·value pairs per row, 1px gaps over the
          line-coloured backing drawing the rules and the column seam — so the two sections
          read as one family. What Properties doesn't carry is the verdict: a status dot on
          the label and the grade colour on the value keep the good/warn/danger reading that
          the old stat cards had, inside the tighter table. An odd count (noise floor makes
          seven) stretches the last cell across both columns so no half-cell is left empty. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
        {cells.map((c, i) => {
          const lastOdd = i === cells.length - 1 && cells.length % 2 === 1
          return (
            <div
              key={c.id}
              data-testid={`loudness-pill-${c.id}`}
              data-grade={c.grade}
              className={`group relative flex items-center justify-between gap-3 bg-[var(--color-field)] px-3 py-2 ${lastOdd ? 'col-span-2' : ''}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GRADE_DOT[c.grade]}`} />
                <span className="truncate text-xs text-fg-dim">{c.label}</span>
              </span>
              <span className={`shrink-0 text-sm font-medium tabular-nums ${GRADE_TEXT[c.grade]}`}>
                {c.value}
              </span>
              <Tooltip label={c.hint} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
