import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CopyFacts, CopyReason, CopyVerdict } from '../lib/bestCopy'
import { formatUpTo } from '../lib/numberFormat'

const LIBRARY = 'Apple Music'

// One sentence per reason and side: the side that loses is the subject, so "this file" and
// "the Apple Music copy" each need their own wording rather than one key with a name in it.
const LIBRARY_LOSES: Record<CopyReason, string> = {
  lossless: 'editor.copyLossyLibrary',
  transcode: 'editor.copyTranscodeLibrary',
  cutoff: 'editor.copyCutoffLibrary',
  processed: 'editor.copyProcessedLibrary',
  upsampled: 'editor.copyUpsampledLibrary',
  peakCount: 'editor.copyLimited',
  crest: 'editor.copyCrestLibrary',
}
const HERE_LOSES: Record<CopyReason, string> = {
  lossless: 'editor.copyLossy',
  transcode: 'editor.copyTranscode',
  cutoff: 'editor.copyCutoff',
  processed: 'editor.copyProcessed',
  upsampled: 'editor.copyUpsampled',
  peakCount: 'editor.copyLimitedHere',
  crest: 'editor.copyCrest',
}

type RowId = 'cutoff' | 'loudness' | 'crest' | 'peakCount'

// The row whose figures carried the verdict. Processed and upsampled are read off the shape
// of the spectrum, not a number in this table, so no row claims them.
const DECIDING_ROW: Partial<Record<CopyReason, RowId>> = {
  lossless: 'cutoff',
  transcode: 'cutoff',
  cutoff: 'cutoff',
  peakCount: 'peakCount',
  crest: 'crest',
}

const BORDER = {
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  neutral: 'var(--color-line-strong)',
} as const

export function CopyComparison({
  verdict,
  here,
  library,
  hereLabel,
  libraryLabel,
}: {
  verdict: CopyVerdict
  here: CopyFacts
  library: CopyFacts
  hereLabel: string
  libraryLabel: string
}): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const lang = i18n.language
  const num = (value: number | null | undefined, digits: number): string =>
    value == null ? '—' : formatUpTo(value, digits, lang)
  const khz = (hz: number | undefined): string => num(hz == null ? hz : hz / 1000, 1)

  function sentence(): string {
    if (verdict.winner === 'same') return tr('editor.copySameAudio')
    if (verdict.winner === 'tie') return tr('editor.copyNoDifference')
    const [loser, winner] = verdict.winner === 'a' ? [library, here] : [here, library]
    const key = (verdict.winner === 'a' ? LIBRARY_LOSES : HERE_LOSES)[verdict.reason]
    const louder =
      loser.integratedLufs != null && winner.integratedLufs != null
        ? loser.integratedLufs - winner.integratedLufs
        : 0
    // The limited copy is usually the louder one, but not always; the loudness clause only
    // stays when it is true at the precision shown.
    const notLouder = verdict.reason === 'peakCount' && Math.round(louder * 10) <= 0
    const shown = !notLouder
      ? key
      : verdict.winner === 'a'
        ? 'editor.copyLimitedNotLouder'
        : 'editor.copyLimitedHereNotLouder'
    return tr(shown, {
      loser: LIBRARY,
      winner: LIBRARY,
      db: num(louder, 1),
      count: num(loser.peakCount, 0),
      cutoff: khz(loser.cutoffHz),
      crest: num(loser.crestDb, 1),
      other: verdict.reason === 'crest' ? num(winner.crestDb, 1) : khz(winner.cutoffHz),
    })
  }

  const rows: { id: RowId; label: string; here: string; library: string }[] = [
    {
      id: 'cutoff',
      label: tr('editor.copyRowCutoff'),
      here: `${khz(here.cutoffHz)} kHz`,
      library: `${khz(library.cutoffHz)} kHz`,
    },
    {
      id: 'loudness',
      label: tr('editor.loudnessLufsLabel'),
      here: `${num(here.integratedLufs, 1)} LUFS`,
      library: `${num(library.integratedLufs, 1)} LUFS`,
    },
    {
      id: 'crest',
      label: tr('editor.loudnessCrestLabel'),
      here: `${num(here.crestDb, 1)} dB`,
      library: `${num(library.crestDb, 1)} dB`,
    },
    {
      id: 'peakCount',
      label: tr('editor.copyRowPeakCount'),
      here: num(here.peakCount, 0),
      library: num(library.peakCount, 0),
    },
  ]
  const decided = 'reason' in verdict ? verdict : null
  const decidingRow = decided ? DECIDING_ROW[decided.reason] : undefined
  const tone = verdict.winner === 'a' ? 'good' : verdict.winner === 'b' ? 'warn' : 'neutral'
  const cellTone = (side: 'a' | 'b'): string =>
    decided?.winner === side ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]'

  return (
    <div
      data-testid="copy-comparison"
      data-tone={tone}
      className="mt-2 border-l-2 pl-2.5 text-xs"
      style={{ borderColor: BORDER[tone] }}
    >
      <p data-testid="copy-sentence" className="text-fg-dim">
        {sentence()}
      </p>
      <table className="mt-2 tabular-nums text-fg-dim">
        <thead>
          <tr>
            <th />
            <th className="pl-4 text-right font-medium">
              {tr('editor.copyThisFile')} · {hereLabel}
            </th>
            <th className="pl-4 text-right font-medium">
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
                className={decides ? 'text-fg' : undefined}
              >
                <th scope="row" className="text-left font-normal">
                  {row.label}
                </th>
                <td className={`pl-4 text-right ${decides ? cellTone('a') : ''}`}>{row.here}</td>
                <td className={`pl-4 text-right ${decides ? cellTone('b') : ''}`}>{row.library}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
