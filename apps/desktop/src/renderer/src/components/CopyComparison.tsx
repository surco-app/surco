import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CopyFacts, CopyReason } from '../lib/bestCopy'
import { formatUpTo } from '../lib/numberFormat'

const LIBRARY = 'Apple Music'

type RowId = 'cutoff' | 'loudness' | 'crest' | 'peakCount'

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
}: {
  id?: string
  // A tie opens no card, and same audio has nothing to weigh.
  verdict: { winner: 'a' | 'b'; reason: CopyReason }
  here: CopyFacts
  library: CopyFacts
  hereLabel: string
  libraryLabel: string
  // The waves behind the verdict, set above the table.
  glimpse?: React.ReactNode
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lang = i18n.language
  const num = (value: number, digits: number): string => formatUpTo(value, digits, lang)
  const cell = (value: number | null | undefined, digits: number, unit = ''): string =>
    value == null ? '—' : `${num(value, digits)}${unit}`

  const rows: { id: RowId; label: string; here: string; library: string }[] = [
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
    verdict.reason === 'transcode' &&
    loser.cutoffHz != null &&
    winner.cutoffHz != null &&
    Math.round(winner.cutoffHz / 100) > Math.round(loser.cutoffHz / 100)
  const decidingRow = transcodeShown ? 'cutoff' : DECIDING_ROW[verdict.reason]
  const winnerSide = verdict.winner === 'a' ? 'here' : 'library'
  // The winning figure takes the verdict's colour: green when this file wins, amber when the
  // library holds the better copy, the same colours as the glyph in the section's header.
  const winnerTone =
    verdict.winner === 'a' ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'

  return (
    <div
      id={id}
      data-testid="copy-comparison"
      // No rule of its own: the verdict glyph above carries the colour, and this is its
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
              <th className="px-3 py-2 text-right text-xs font-normal text-fg-dim">
                {tr('editor.copyThisFile')} · {hereLabel}
              </th>
              <th className="px-3 py-2 text-right text-xs font-normal text-fg-dim">
                {LIBRARY} · {libraryLabel}
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
                  className="border-t border-[var(--color-line)]"
                >
                  <th
                    scope="row"
                    className={`px-3 py-2 text-left text-xs font-normal ${decides ? 'text-fg' : 'text-fg-dim'}`}
                  >
                    {row.label}
                  </th>
                  {(['here', 'library'] as const).map((side) => {
                    const wins = decides && side === winnerSide
                    return (
                      <td
                        key={side}
                        data-winner={wins ? side : undefined}
                        className={`px-3 py-2 text-right text-sm font-medium ${wins ? winnerTone : ''}`}
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
