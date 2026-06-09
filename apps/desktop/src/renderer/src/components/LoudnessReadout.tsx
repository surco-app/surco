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
import { Tooltip } from './Tooltip'

// Per-grade colour for the analysis stat cells, reusing the good/warn/danger tokens
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

// The EBU R128 figures as colour-graded pills, grouped Loudness / Signal. The
// astats-derived checks each appear only when measured (null = mono, a dead channel,
// or an unparseable reading), so an immeasurable pill drops out rather than showing
// "−∞ dB" / "NaN%".
export function LoudnessReadout({ loudness: loud, onShowHelp }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const cell = (id: string, label: string, value: string, grade: Grade, hint: string) => ({
    id,
    label,
    value,
    grade,
    hint,
  })
  const groups = [
    {
      id: 'loudness',
      label: tr('editor.loudnessGroupLoudness'),
      cells: [
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
      ].filter((c) => c !== false),
    },
    {
      id: 'signal',
      label: tr('editor.loudnessGroupSignal'),
      cells: [
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
      ].filter((c) => c !== false),
    },
  ].filter((g) => g.cells.length > 0)
  return (
    <div data-testid="loudness-readout" className="mt-3 space-y-3">
      {groups.map((group, gi) => (
        <div key={group.id}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-fg-dim">
              {group.label}
            </span>
            {gi === 0 && (
              <button
                type="button"
                data-testid="loudness-help-toggle"
                aria-label={tr('editor.loudnessHelpTitle')}
                onClick={onShowHelp}
                className="press group relative flex h-5 w-5 items-center justify-center rounded-full text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <Tooltip label={tr('editor.loudnessHelpTitle')} align="end" />
              </button>
            )}
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr))]">
            {group.cells.map((c) => (
              <div
                key={c.id}
                data-testid={`loudness-pill-${c.id}`}
                data-grade={c.grade}
                className="group relative rounded-lg bg-[var(--color-field)] px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GRADE_DOT[c.grade]}`} />
                  <span className="truncate text-[10px] uppercase tracking-wide text-fg-dim">
                    {c.label}
                  </span>
                </div>
                <div className={`mt-0.5 text-sm font-medium tabular-nums ${GRADE_TEXT[c.grade]}`}>
                  {c.value}
                </div>
                <Tooltip label={c.hint} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
