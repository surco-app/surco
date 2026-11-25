import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CopyFacts, CopyReason, CopyVerdict } from '../lib/bestCopy'
import { formatTime } from '../lib/duration'
import { formatUpTo } from '../lib/numberFormat'

type RowId = 'duration' | 'cutoff' | 'loudness' | 'crest' | 'peakCount'

// The row whose figures carried the verdict. Lossy against lossless is decided by the
// formats, so it colours no row: a knee-less 16 kHz WAV beating a 20 kHz MP3 would read as
// the lower number winning. A transcode is settled below, against its own figures.
const DECIDING_ROW: Partial<Record<CopyReason, RowId>> = {
  cutoff: 'cutoff',
  peakCount: 'peakCount',
  crest: 'crest',
}

export function CopyComparison({
  id,
  verdict,
  here,
  library,
  hereLabel,
  libraryLabel,
  glimpse,
  libraryName,
  hereDurationSec,
  libraryDurationSec,
}: {
  id?: string
  // Same audio has nothing to weigh, so it opens no card.
  verdict: Exclude<CopyVerdict, { winner: 'same' }>
  here: CopyFacts
  library: CopyFacts
  hereLabel: string
  libraryLabel: string
  // Another version differs in length, and so does one master across a gap of silence, so
  // either card leads with both.
  hereDurationSec?: number
  libraryDurationSec?: number
  // The waves behind the verdict, set above the table.
  glimpse?: React.ReactNode
  libraryName: string
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lang = i18n.language
  const num = (value: number, digits: number): string => formatUpTo(value, digits, lang)
  const cell = (value: number | null | undefined, digits: number, unit = ''): string =>
    value == null ? '—' : `${num(value, digits)}${unit}`

  const length = (seconds: number | undefined): string =>
    seconds == null ? '—' : formatTime(seconds)

  const rows: { id: RowId; label: string; here: string; library: string }[] = [
    ...(verdict.winner === 'different' || verdict.sameMasterAcrossGap
      ? [
          {
            id: 'duration' as const,
            label: tr('editor.propDuration'),
            here: length(hereDurationSec),
            library: length(libraryDurationSec),
          },
        ]
      : []),
    {
      id: 'cutoff',
      label: tr('editor.copyRowCutoff'),
      here: cell(here.cutoffHz == null ? null : here.cutoffHz / 1000, 1, ' kHz'),
      library: cell(library.cutoffHz == null ? null : library.cutoffHz / 1000, 1, ' kHz'),
    },
    {
      id: 'loudness',
      label: tr('editor.loudnessLufsLabel'),
      here: cell(here.integratedLufs, 1, ' LUFS'),
      library: cell(library.integratedLufs, 1, ' LUFS'),
    },
    {
      id: 'crest',
      label: tr('editor.loudnessCrestLabel'),
      here: cell(here.crestDb, 1, ' dB'),
      library: cell(library.crestDb, 1, ' dB'),
    },
    {
      id: 'peakCount',
      label: tr('editor.copyRowPeakCount'),
      here: cell(here.peakCount, 0),
      library: cell(library.peakCount, 0),
    },
  ]
  const [loser, winner] = verdict.winner === 'a' ? [library, here] : [here, library]
  // A transcode is called on the loser's knee alone, so its cutoffs are the evidence only when
  // the winner reaches higher as printed: marking a lower or equal figure would argue against
  // the verdict.
  const transcodeShown =
    'reason' in verdict &&
    verdict.reason === 'transcode' &&
    loser.cutoffHz != null &&
    winner.cutoffHz != null &&
    Math.round(winner.cutoffHz / 100) > Math.round(loser.cutoffHz / 100)
  // Copies nothing separates have no deciding row: the reader weighs the figures.
  const decidingRow =
    'reason' in verdict ? (transcodeShown ? 'cutoff' : DECIDING_ROW[verdict.reason]) : undefined
  const winnerSide = verdict.winner === 'a' ? 'here' : 'library'
  // The winning figure takes the verdict's colour: green when this file wins, amber when the
  // library holds the better copy, the same colours as the row's state pill.
  const winnerTone =
    verdict.winner === 'a' ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'

  return (
    <div
      id={id}
      data-testid="copy-comparison"
      // No rule of its own: the row's state pill above carries the colour, and this is its
      // detail, set in line with the library row.
      className="mt-1.5 pl-3 text-xs"
    >
      {glimpse}
      {/* The Properties readout's table: rows on the field colour, split by hairlines, labels
          small and dim, figures at reading size. */}
      <div className="mt-2 overflow-hidden rounded-lg bg-[var(--color-field)]">
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th />
              <th className="px-1 py-2 @min-[22rem]:px-3 @min-[22rem]:whitespace-nowrap text-right text-xs font-normal text-fg-dim">
                {tr('editor.copyThisFile')} · {hereLabel}
              </th>
              <th className="px-1 py-2 @min-[22rem]:px-3 text-right text-xs font-normal text-fg-dim">
                {libraryName} · {libraryLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const decides = row.id === decidingRow
              return (
                <tr
                  key={row.id}
                  data-testid={`copy-row-${row.id}`}
                  data-decides={decides ? 'true' : undefined}
                  className="border-t border-[var(--color-line)] @max-[22rem]:relative"
                >
                  <th
                    scope="row"
                    className={`px-1 py-2 @max-[22rem]:absolute @max-[22rem]:left-1 @max-[22rem]:top-1 @max-[22rem]:p-0 @min-[22rem]:w-[30%] @min-[22rem]:px-3 text-left text-xs font-normal ${decides ? 'text-fg' : 'text-fg-dim'}`}
                  >
                    {row.label}
                  </th>
                  {(['here', 'library'] as const).map((side) => {
                    const wins = decides && side === winnerSide
                    return (
                      <td
                        key={side}
                        data-winner={wins ? side : undefined}
                        className={`whitespace-nowrap px-1 py-2 @max-[22rem]:pt-5 @min-[22rem]:px-3 text-right text-xs @min-[22rem]:text-sm font-medium ${wins ? winnerTone : ''}`}
                      >
                        {row[side]}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
