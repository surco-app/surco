import type { TFunction } from 'i18next'
import type { GridCheck } from '../../../shared/gridCheck'
import { formatUpTo } from './numberFormat'

export interface GridNote {
  text: string
  title: string
}

const signed = (value: number, language: string): string =>
  `${value < 0 ? '−' : '+'}${formatUpTo(Math.abs(value), 1, language)}`

const shiftNote = (ms: number, tr: TFunction, language: string): GridNote => ({
  text: `${signed(ms, language)} ms`,
  title: tr(ms < 0 ? 'trackList.gridEarly' : 'trackList.gridLate', { ms: Math.abs(ms) }),
})

export function gridNote(check: GridCheck, tr: TFunction, language: string): GridNote {
  const { verdict } = check
  if (verdict === null)
    return shiftNote(
      Math.abs(check.hereMs) >= Math.abs(check.endMs) ? check.hereMs : check.endMs,
      tr,
      language,
    )
  if (verdict.kind === 'shifted') return shiftNote(verdict.ms, tr, language)
  return {
    text: `${signed(verdict.msPerMin, language)} ms/min`,
    title: tr(verdict.msPerMin < 0 ? 'trackList.gridDriftsEarly' : 'trackList.gridDriftsLate', {
      ms: formatUpTo(Math.abs(verdict.msPerMin), 1, language),
    }),
  }
}
