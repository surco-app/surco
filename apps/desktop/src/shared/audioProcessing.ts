import { declickFilter } from './declick'
import { trimFilter } from './trim'
import type { DeclickMode, NormalizeConfig, TrimRange } from './types'

export interface AudioProcessing {
  normalize?: NormalizeConfig
  declick?: DeclickMode
  trim?: TrimRange
}

export function processesAudio({ normalize, declick, trim }: AudioProcessing): boolean {
  return (
    (normalize !== undefined && normalize.mode !== 'none') ||
    declickFilter(declick ?? 'off') !== null ||
    trimFilter(trim) !== null
  )
}

export function tagsOnly(sameFormat: boolean, processing: AudioProcessing): boolean {
  return sameFormat && !processesAudio(processing)
}
