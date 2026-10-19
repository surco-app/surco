import type { TFunction } from 'i18next'
import type { CueFlow } from '../../../shared/cueFlows'

export function flowName(flow: CueFlow, t: TFunction): string {
  return flow.name || t(`cueFlows.builtIn.${flow.id}`, { defaultValue: t('cueFlows.unnamed') })
}
