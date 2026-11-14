import type { TFunction } from 'i18next'
import { type GridCheck, gridVerdictOf } from '../../../shared/gridAudit'
import { formatUpTo } from './numberFormat'

export interface GridNote {
  text: string
  title: string
}

const signed = (value: number, language: string): string =>
  `${value < 0 ? '−' : '+'}${formatUpTo(Math.abs(value), 1, language)}`

export function gridNote(
  check: GridCheck,
  toleranceMs: number,
  tr: TFunction,
  language: string,
): GridNote | undefined {
  const verdict = gridVerdictOf(check, toleranceMs)
  if (verdict === null) return undefined
  if (verdict.kind === 'tempo')
    return { text: tr('trackList.gridTempoShort'), title: tr('trackList.gridTempo') }
  const gridMs = -verdict.ms
  const early = gridMs < 0
  const key =
    verdict.kind === 'partial'
      ? early
        ? 'trackList.gridPartlyEarly'
        : 'trackList.gridPartlyLate'
      : early
        ? 'trackList.gridEarly'
        : 'trackList.gridLate'
  return { text: `${signed(gridMs, language)} ms`, title: tr(key, { ms: Math.abs(gridMs) }) }
}
