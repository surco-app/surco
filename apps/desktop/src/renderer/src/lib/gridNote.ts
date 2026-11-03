import type { TFunction } from 'i18next'
import type { GridVerdict } from '../../../shared/gridVerdict'
import { formatUpTo } from './numberFormat'

export function gridNote(verdict: GridVerdict, tr: TFunction, language: string): string {
  if (verdict.kind === 'shifted')
    return tr(verdict.ms < 0 ? 'trackList.gridEarly' : 'trackList.gridLate', {
      ms: Math.abs(verdict.ms),
    })
  return tr(verdict.msPerMin < 0 ? 'trackList.gridDriftsEarly' : 'trackList.gridDriftsLate', {
    ms: formatUpTo(Math.abs(verdict.msPerMin), 1, language),
  })
}
