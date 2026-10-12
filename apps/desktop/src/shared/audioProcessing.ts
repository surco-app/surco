import { DEFAULT_DECLICK, declickFilter } from './declick'
import { trimFilter } from './trim'
import type { DeclickConfig, NormalizeConfig, TrimRange } from './types'

export interface AudioProcessing {
  normalize?: NormalizeConfig
  declick?: DeclickConfig
  trim?: TrimRange
}

export function processesAudio({ normalize, declick, trim }: AudioProcessing): boolean {
  return (
    (normalize !== undefined && normalize.mode !== 'none') ||
    declickFilter(declick ?? DEFAULT_DECLICK) !== null ||
    trimFilter(trim) !== null
  )
}

export function tagsOnly(sameFormat: boolean, processing: AudioProcessing): boolean {
  return sameFormat && !processesAudio(processing)
}
