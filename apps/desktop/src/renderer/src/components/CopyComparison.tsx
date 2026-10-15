import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { CopyFacts, CopyReason, CopyVerdict } from '../lib/bestCopy'
import { formatUpTo } from '../lib/numberFormat'

const LIBRARY = 'Apple Music'

interface SentenceKeys {
  full: string
  // The same claim without its figures, for a copy whose measurement is missing: a
  // placeholder in a sentence reads as a broken claim.
  bare: string
  notLouder?: string
}

// One sentence per reason and side: the side that loses is the subject, so "this file" and
// "the Apple Music copy" each need their own wording rather than one key with a name in it.
const LIBRARY_LOSES: Record<CopyReason, SentenceKeys> = {
  lossless: { full: 'editor.copyLossyLibrary', bare: 'editor.copyLossyLibrary' },
  transcode: { full: 'editor.copyTranscodeLibrary', bare: 'editor.copyTranscodeLibraryBare' },
  cutoff: { full: 'editor.copyCutoffLibrary', bare: 'editor.copyCutoffLibraryBare' },
  processed: { full: 'editor.copyProcessedLibrary', bare: 'editor.copyProcessedLibrary' },
  upsampled: { full: 'editor.copyUpsampledLibrary', bare: 'editor.copyUpsampledLibrary' },
  peakCount: {
    full: 'editor.copyLimited',
    bare: 'editor.copyLimitedBare',
    notLouder: 'editor.copyLimitedNotLouder',
  },
  crest: { full: 'editor.copyCrestLibrary', bare: 'editor.copyCrestLibraryBare' },
}
const HERE_LOSES: Record<CopyReason, SentenceKeys> = {
  lossless: { full: 'editor.copyLossy', bare: 'editor.copyLossy' },
  transcode: { full: 'editor.copyTranscode', bare: 'editor.copyTranscodeBare' },
  cutoff: { full: 'editor.copyCutoff', bare: 'editor.copyCutoffBare' },
  processed: { full: 'editor.copyProcessed', bare: 'editor.copyProcessed' },
  upsampled: { full: 'editor.copyUpsampled', bare: 'editor.copyUpsampled' },
  peakCount: {
    full: 'editor.copyLimitedHere',
    bare: 'editor.copyLimitedHereBare',
    notLouder: 'editor.copyLimitedHereNotLouder',
  },
  crest: { full: 'editor.copyCrest', bare: 'editor.copyCrestBare' },
}

type RowId = 'cutoff' | 'loudness' | 'crest' | 'peakCount'

// The row whose figures carried the verdict. Lossy against lossless is decided by the
// formats and a transcode by the shape of the spectrum, so neither colours the cutoff row:
// a knee-less 16 kHz WAV beating a 20 kHz MP3 would read as the lower number winning.
const DECIDING_ROW: Partial<Record<CopyReason, RowId>> = {
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
  const num = (value: number, digits: number): string => formatUpTo(value, digits, lang)
  const cell = (value: number | null | undefined, digits: number, unit = ''): string =>
    value == null ? '—' : `${num(value, digits)}${unit}`

  function sentence(): string {
    if (verdict.winner === 'same') return tr('editor.copySameAudio')
    if (verdict.winner === 'tie') return tr('editor.copyNoDifference')
    const [loser, winner] = verdict.winner === 'a' ? [library, here] : [here, library]
    const keys = (verdict.winner === 'a' ? LIBRARY_LOSES : HERE_LOSES)[verdict.reason]
    const names = { loser: LIBRARY, winner: LIBRARY }
    switch (verdict.reason) {
      case 'lossless':
        return tr(keys.full, { ...names, format: loser.ext, otherFormat: winner.ext })
      case 'transcode':
      case 'cutoff':
        if (loser.cutoffHz == null || winner.cutoffHz == null) return tr(keys.bare, names)
        return tr(keys.full, {
          ...names,
          cutoff: num(loser.cutoffHz / 1000, 1),
          other: num(winner.cutoffHz / 1000, 1),
        })
      case 'crest':
        if (loser.crestDb == null || winner.crestDb == null) return tr(keys.bare, names)
        return tr(keys.full, {
          ...names,
          crest: num(loser.crestDb, 1),
          other: num(winner.crestDb, 1),
        })
      case 'peakCount': {
        if (loser.peakCount == null) return tr(keys.bare, names)
        const louder =
          loser.integratedLufs != null && winner.integratedLufs != null
            ? loser.integratedLufs - winner.integratedLufs
            : null
        const count = num(loser.peakCount, 0)
        // The limited copy is usually the louder one, but not always; the loudness clause
        // only stays when it is true at the precision shown.
        if (louder == null || Math.round(louder * 10) <= 0) {
          return tr(keys.notLouder ?? keys.bare, { ...names, count })
        }
        return tr(keys.full, { ...names, count, db: num(louder, 1) })
      }
      default:
        return tr(keys.full, names)
    }
  }

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
