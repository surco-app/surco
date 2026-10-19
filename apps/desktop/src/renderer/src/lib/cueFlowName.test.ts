import { describe, expect, it } from 'vitest'
import { ONE_AT_32 } from '../../../shared/cueFlows'
import i18n from '../i18n'
import { flowName } from './cueFlowName'

const tr = i18n.getFixedT('en')

describe('flowName', () => {
  it('shows the name the user gave a flow, even a bundled one they renamed', () => {
    expect(flowName({ ...ONE_AT_32, name: 'Festival' }, tr)).toBe('Festival')
  })

  it('translates a bundled flow that was never renamed, since it is stored without a name', () => {
    expect(flowName(ONE_AT_32, tr)).toBe('One cue at 32')
  })

  it('calls a flow of the user without a name unnamed instead of showing an empty option', () => {
    expect(flowName({ id: 'x', name: '', rules: [] }, tr)).toBe('Unnamed flow')
  })
})
