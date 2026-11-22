import type { TFunction } from 'i18next'
import type { CopyFacts, CopyReason } from './bestCopy'
import { formatUpTo } from './numberFormat'

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

// Why the winning copy won, in a sentence: the comparison table shows the figures, this says
// what they mean (a lossy source, a limiter), which the figures alone do not.
export function copySentence(
  verdict: { winner: 'a' | 'b'; reason: CopyReason },
  here: CopyFacts,
  library: CopyFacts,
  tr: TFunction,
  lang: string,
): string {
  const num = (value: number, digits: number): string => formatUpTo(value, digits, lang)
  const [loser, winner] = verdict.winner === 'a' ? [library, here] : [here, library]
  const keys = (verdict.winner === 'a' ? LIBRARY_LOSES : HERE_LOSES)[verdict.reason]
  const names = { loser: LIBRARY, winner: LIBRARY }
  switch (verdict.reason) {
    case 'lossless':
      return tr(keys.full, { ...names, format: loser.ext, otherFormat: winner.ext })
    case 'transcode':
    case 'cutoff':
      // A transcode is called on the loser's knee alone, so the winner can cut no higher;
      // "reaches" a lower figure would argue against the verdict. The figures are compared
      // as printed (tenths of a kHz): two that print alike would argue a difference the
      // reader cannot see.
      if (
        loser.cutoffHz == null ||
        winner.cutoffHz == null ||
        Math.round(winner.cutoffHz / 100) <= Math.round(loser.cutoffHz / 100)
      )
        return tr(keys.bare, names)
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
