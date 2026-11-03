import type { TFunction } from 'i18next'
import type { GridVerdict } from '../../../shared/gridVerdict'
import { formatUpTo } from './numberFormat'

export interface GridNote {
  text: string
  title: string
}

const signed = (value: number, language: string): string =>
  `${value < 0 ? '−' : '+'}${formatUpTo(Math.abs(value), 1, language)}`

export function gridNote(verdict: GridVerdict, tr: TFunction, language: string): GridNote {
  if (verdict.kind === 'shifted')
    return {
      text: `${signed(verdict.ms, language)} ms`,
      title: tr(verdict.ms < 0 ? 'trackList.gridEarly' : 'trackList.gridLate', {
        ms: Math.abs(verdict.ms),
      }),
    }
  return {
    text: `${signed(verdict.msPerMin, language)} ms/min`,
    title: tr(verdict.msPerMin < 0 ? 'trackList.gridDriftsEarly' : 'trackList.gridDriftsLate', {
      ms: formatUpTo(Math.abs(verdict.msPerMin), 1, language),
    }),
  }
}
